import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import { createWorld } from "../../src/engine/round.js";
import { PilotPerson } from "../../src/pilot/person.js";
import { pilotOutcomes, runPilot } from "../../src/pilot/run.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

const sam = PilotPerson.parse(
	JSON.parse(readFileSync("profiles/example.json", "utf8")),
);
const kim: PilotPerson = {
	...sam,
	profile: { ...sam.profile, id: "p-k1m0", name: "Kim" },
	notes: [],
};

// A model that never answers in the right shape, so every agent falls back to its safe default.
const silentClient = () =>
	createLlmClient(config, {
		fetch: (async () =>
			new Response(
				JSON.stringify({
					choices: [{ message: { content: "not json" } }],
				}),
			)) as typeof globalThis.fetch,
		retry: { sleep: async () => {} },
	});

describe("runPilot", () => {
	test("real people join generated ones, each agent with only its own human's notes", async () => {
		const world = await runPilot(silentClient(), [sam, kim], {
			fill: 3,
			maxRounds: 1,
		});
		expect(Object.keys(world.agents).sort()).toEqual([
			"p-7f3a",
			"p-k1m0",
			"p1",
			"p2",
			"p3",
		]);
		expect(world.agents["p-7f3a"]!.notes).toEqual(sam.notes);
		expect(world.agents["p-k1m0"]!.notes).toEqual([]);
		expect(world.agents.p1!.notes).toEqual([]);
	});
});

describe("pilotOutcomes", () => {
	test("lists each real person's team, or none, without revealing teammates' names", () => {
		const world = {
			...createWorld([sam.profile, kim.profile]),
			teams: [
				{
					id: "team-p-7f3a",
					members: ["p-7f3a", "p2"],
					project: {
						title: "Study buddy",
						description: "Revise together.",
					},
					rolesNeeded: ["backend"],
					status: "committed" as const,
				},
			],
		};
		expect(pilotOutcomes(world, [sam, kim])).toEqual([
			{
				id: "p-7f3a",
				name: "Sam Rivera",
				team: {
					members: ["p-7f3a", "p2"],
					project: "Revise together.",
				},
			},
			{ id: "p-k1m0", name: "Kim", team: undefined },
		]);
	});
});
