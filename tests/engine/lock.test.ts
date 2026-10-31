import { describe, expect, test } from "vitest";
import { contactOf, recordMessage } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import type { RunEvent } from "../../src/engine/events.js";
import { lockMessages, runLock } from "../../src/engine/lock.js";
import type { Profile } from "../../src/engine/profile.js";
import { createWorld, type World } from "../../src/engine/round.js";
import type { Team } from "../../src/engine/team.js";
import { person } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

function human(id: string, skill = "frontend"): Profile {
	return {
		...person(id, [{ name: skill, level: "expert" }], ["education"], 0),
		name: `Name of ${id}`,
	};
}

// a's group with j and k (or just j), tentative, building a tutor that still needs design.
function group(members = ["a", "j", "k"]): World {
	const world = createWorld(members.map((id) => human(id)));
	const team: Team = {
		id: "team-a",
		members,
		project: { title: "Tutor", description: "An AI tutor." },
		rolesNeeded: ["frontend", "design"],
		status: "tentative",
	};
	return { ...world, teams: [team] };
}

// A fake model answering the deadline prompt from `answers`: each agent's answers in order, one per ask
// (true for confident); anything that isn't a boolean is an invalid reply.
function fakeClient(answers: Record<string, unknown[]> = {}) {
	const prompts: Record<string, string[]> = {};
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string);
		const who = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
		(prompts[who] ??= []).push(JSON.stringify(messages));
		const next = answers[who]?.length ? answers[who].shift() : true;
		const reply = { rationale: "Weighed it.", confident: next };
		return new Response(
			JSON.stringify({
				choices: [{ message: { content: JSON.stringify(reply) } }],
			}),
		);
	}) as typeof globalThis.fetch;
	const client = createLlmClient(config, {
		fetch,
		retry: { sleep: async () => {} },
	});
	return { client, prompts };
}

async function lock(
	world: World,
	answers: Record<string, unknown[]> = {},
	revealNames = true,
) {
	const events: RunEvent[] = [];
	const { client, prompts } = fakeClient(answers);
	const result = await runLock(client, world, {
		revealNames,
		onEvent: (e) => events.push(e),
	});
	return { ...result, events, prompts };
}

const sent = (events: RunEvent[]) =>
	events.flatMap((e) =>
		e.type === "bus" && e.event.type === "sent" && "kind" in e.event.message
			? [
					`${e.event.message.from}→${e.event.message.to} ${e.event.message.kind}`,
				]
			: [],
	);

describe("runLock", () => {
	test("when everyone is confident, the group is committed and everyone learns everyone's name, strangers included", async () => {
		const { world, dropped, events } = await lock(group());
		expect(dropped).toEqual([]);
		expect(world.teams).toEqual([
			expect.objectContaining({
				members: ["a", "j", "k"],
				status: "committed",
			}),
		]);
		expect(contactOf(world.agents.j!, "k").learned.name).toBe("Name of k");
		expect(contactOf(world.agents.k!, "a").learned.name).toBe("Name of a");
		expect(
			events.filter((e) => e.type === "lock").map((e) => e.agent),
		).toEqual(["a", "j", "k"]);
	});

	test("a 'no' drops just that person; the rest are asked once more and stay a team", async () => {
		const { world, dropped, events } = await lock(group(), {
			j: [false],
		});
		expect(dropped).toEqual(["j"]);
		expect(world.teams.map((t) => t.members)).toEqual([["a", "k"]]);
		const asks = events.flatMap((e) =>
			e.type === "lock" ? [`${e.agent}:${e.ask}`] : [],
		);
		expect(asks).toEqual(["a:1", "j:1", "k:1", "a:2", "k:2"]);
		expect(sent(events)).toEqual(
			expect.arrayContaining(["j→a leave", "j→k leave"]),
		);
		// Whoever dropped out learns no one's name, and no one learns theirs.
		expect(contactOf(world.agents.j!, "a").learned.name).toBeUndefined();
		expect(contactOf(world.agents.a!, "j").learned.name).toBeUndefined();
		expect(contactOf(world.agents.a!, "k").learned.name).toBe("Name of k");
	});

	test("a second 'no' on the re-ask also drops out, and a group left with one person dissolves", async () => {
		const { world, dropped } = await lock(group(), {
			j: [false],
			k: [true, false],
		});
		expect(dropped).toEqual(["j", "k"]);
		expect(world.teams).toEqual([]);
		expect(contactOf(world.agents.a!, "k").learned.name).toBeUndefined();
	});

	test("a 'no' in a pair dissolves it, with no re-ask", async () => {
		const { world, events } = await lock(group(["a", "j"]), {
			a: [false],
		});
		expect(world.teams).toEqual([]);
		expect(events.filter((e) => e.type === "lock")).toHaveLength(2);
	});

	test("if the owner drops out, the group goes on without them, keeping its id and project", async () => {
		const { world } = await lock(group(), { a: [false] });
		expect(world.teams).toEqual([
			expect.objectContaining({
				id: "team-a",
				members: ["j", "k"],
				project: { title: "Tutor", description: "An AI tutor." },
				status: "committed",
			}),
		]);
	});

	test("if no valid answer comes back, the member drops out: names can't be unshared", async () => {
		const { dropped, events } = await lock(group(), {
			j: Array(10).fill("maybe"),
		});
		expect(dropped).toEqual(["j"]);
		expect(
			events.find((e) => e.type === "lock" && e.agent === "j"),
		).toMatchObject({ confident: false, fellBack: true });
	});

	test("with names held back for approval, the team is committed but nobody swaps names", async () => {
		const { world, events } = await lock(group(), {}, false);
		expect(world.teams[0]!.status).toBe("committed");
		expect(sent(events)).toEqual([]);
		expect(contactOf(world.agents.j!, "k").learned.name).toBeUndefined();
	});

	test("teams already committed are left alone", async () => {
		const world = group();
		world.teams = [{ ...world.teams[0]!, status: "committed" }];
		const { events, world: after } = await lock(world);
		expect(events.filter((e) => e.type === "lock")).toEqual([]);
		expect(after.teams).toEqual(world.teams);
	});
});

describe("lockMessages", () => {
	test("shows the group, says the deadline is now, and counts members never talked to", () => {
		const world = group();
		// j has talked with a, never with k.
		const j = recordMessage(world.agents.j!, "a", {
			id: "p1",
			from: "a",
			to: "j",
			pitch: "An AI tutor.",
			rolesNeeded: ["frontend"],
		});
		const [system, user] = lockMessages(j, world.teams[0]!, ["design"], 1);
		expect(system!.content).toContain("this is the deadline");
		expect(system!.content).toContain(
			"You haven't talked with one member; nothing about them is known yet.",
		);
		expect(system!.content).toContain("Facts about you and a");
		expect(system!.content).not.toContain("Facts about you and k");
		expect(user!.content).toBe(
			'Your group: {"project":{"title":"Tutor","description":"An AI tutor."},"size":3,"rolesStillNeeded":["design"]}',
		);
	});

	test("the re-ask says the group changed", () => {
		const world = group(["a", "j"]);
		const [system] = lockMessages(world.agents.a!, world.teams[0]!, [], 2);
		expect(system!.content).toContain(
			"Someone dropped out of your human's group at the deadline",
		);
	});
});
