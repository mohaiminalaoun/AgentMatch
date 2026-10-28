import { describe, expect, test } from "vitest";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import { buildBoard } from "../../src/engine/discovery.js";
import type { RunEvent } from "../../src/engine/events.js";
import { listingMessages, writeListings } from "../../src/engine/listing.js";
import type { Message } from "../../src/engine/llm.js";
import type { Profile } from "../../src/engine/profile.js";
import { createWorld, proposalFrom } from "../../src/engine/round.js";
import { person } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// Nia: an ML expert whose idea is an AI note-taking app.
const nia: Profile = {
	...person("nia", [{ name: "ml", level: "expert" }], ["education"], 0),
	projectIdeas: [
		{
			title: "AI note-taking app",
			description: "Notes for university students.",
		},
	],
};
// Omar has no project idea, so writes no listing.
const omar: Profile = {
	...person("omar", [{ name: "data", level: "expert" }], ["finance"], 5.5),
	projectIdeas: [],
};

const good = {
	rationale: "An AI notes app needs a frontend and data work.",
	pitch: "An AI note-taking app that turns lectures into study notes.",
	rolesNeeded: ["frontend", "data"],
};

// A client whose fake model gives each listing in turn (repeating the last), recording what it was sent.
function fakeModel(...listings: object[]) {
	const sent: Message[][] = [];
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		sent.push(JSON.parse(init!.body as string).messages);
		const content = JSON.stringify(
			listings[Math.min(sent.length, listings.length) - 1],
		);
		return new Response(
			JSON.stringify({ choices: [{ message: { content } }] }),
		);
	}) as typeof globalThis.fetch;
	const client = createLlmClient(config, {
		fetch,
		retry: { sleep: async () => {} },
	});
	return { client, sent };
}

describe("writeListings", () => {
	test("the written listing becomes the agent's board entry and its proposals' terms", async () => {
		const { client } = fakeModel(good);
		const world = await writeListings(client, createWorld([nia, omar]));
		expect(buildBoard(world)).toEqual([
			{ id: "nia", pitch: good.pitch, rolesNeeded: ["frontend", "data"] },
		]);
		expect(proposalFrom(world.agents.nia!, "omar", "p1")).toMatchObject({
			pitch: good.pitch,
			rolesNeeded: ["frontend", "data"],
		});
	});

	test("roles beyond the core four can be listed, so ml and data people are wanted", async () => {
		const { client } = fakeModel(good);
		const world = await writeListings(client, createWorld([nia, omar]));
		expect(world.agents.nia!.listing!.rolesNeeded).toContain("data");
	});

	test("a listing that mentions a private field is redrafted", async () => {
		const { client, sent } = fakeModel(
			{ ...good, pitch: "An ML expert's AI note-taking app." },
			good,
		);
		const world = await writeListings(client, createWorld([nia]));
		expect(world.agents.nia!.listing!.pitch).toBe(good.pitch);
		expect(sent).toHaveLength(2);
		expect(sent[1]!.at(-1)!.content).toContain('mentions "ml" (skills)');
	});

	test("listing your own skill as a role needed is redrafted", async () => {
		const { client, sent } = fakeModel(
			{ ...good, rolesNeeded: ["frontend", "ml"] },
			good,
		);
		await writeListings(client, createWorld([nia]));
		expect(sent[1]!.at(-1)!.content).toContain("roles needed list");
	});

	test("an unknown role is redrafted", async () => {
		const { client, sent } = fakeModel(
			{ ...good, rolesNeeded: ["wizard"] },
			good,
		);
		await writeListings(client, createWorld([nia]));
		expect(sent[1]!.at(-1)!.content).toContain(
			'"wizard" isn\'t a known role',
		);
	});

	test("if no valid listing comes back, the agent keeps the built-in pitch", async () => {
		const { client } = fakeModel({ ...good, pitch: "By an ML expert." });
		const world = await writeListings(client, createWorld([nia]));
		expect(world.agents.nia!.listing).toBeUndefined();
		expect(buildBoard(world)[0]!.pitch).toBe(
			"AI note-taking app: Notes for university students.",
		);
	});

	test("agents without a project idea make no call", async () => {
		const { client, sent } = fakeModel(good);
		await writeListings(client, createWorld([omar]));
		expect(sent).toHaveLength(0);
	});

	test("each listing is emitted as an event, with gate blocks counted", async () => {
		const { client } = fakeModel(
			{ ...good, pitch: "An ML expert's AI note-taking app." },
			good,
		);
		const events: RunEvent[] = [];
		await writeListings(client, createWorld([nia]), {
			onEvent: (e) => events.push(e),
		});
		expect(events.filter((e) => e.type === "listing")).toEqual([
			{
				type: "listing",
				agent: "nia",
				pitch: good.pitch,
				rolesNeeded: ["frontend", "data"],
				rationale: good.rationale,
				gateBlocks: 1,
				fellBack: false,
			},
		]);
	});

	test("the world passed in is left unchanged", async () => {
		const { client } = fakeModel(good);
		const before = createWorld([nia]);
		await writeListings(client, before);
		expect(before.agents.nia!.listing).toBeUndefined();
	});

	test("the prompt offers every role and says to list only roles others would fill", () => {
		const [system] = listingMessages(createWorld([nia]).agents.nia!);
		expect(system!.content).toContain(
			"frontend, backend, mobile, ml, data, design, devops, product",
		);
		expect(system!.content).toContain("never one your human would fill");
	});
});
