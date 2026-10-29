import { describe, expect, test } from "vitest";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import { createWorld } from "../../src/engine/round.js";
import { evaluateAgents, teamsOf } from "../../src/evaluation/agents.js";
import { generateProfiles } from "../../src/evaluation/profiles.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// A fake model under which nobody lists anything new or approaches anyone, so every run ends at once.
function quietClient() {
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string);
		const last: string = messages.at(-1).content;
		const reply =
			last === "Write the listing."
				? {
						rationale: "r",
						pitch: "A project.",
						rolesNeeded: ["design"],
					}
				: { rationale: "r", approach: [] };
		return new Response(
			JSON.stringify({
				choices: [{ message: { content: JSON.stringify(reply) } }],
			}),
		);
	}) as typeof globalThis.fetch;
	return createLlmClient(config, { fetch, retry: { sleep: async () => {} } });
}

describe("teamsOf", () => {
	test("gives each team's members as profiles, owner first", () => {
		const profiles = generateProfiles(4, 1);
		const world = createWorld(profiles);
		world.teams = [
			{
				id: "team-p1",
				members: ["p1", "p3"],
				project: { title: "T", description: "D" },
				rolesNeeded: ["design"],
				status: "committed",
			},
		];
		expect(teamsOf(world)).toEqual([[profiles[0], profiles[2]]]);
	});
});

describe("evaluateAgents", () => {
	test("runs every seed on the same people as the baselines and reports a row like theirs", async () => {
		const seen: number[] = [];
		const { row, perSeed } = await evaluateAgents(
			quietClient(),
			{ seeds: [1, 2], people: 6, maxRounds: 2 },
			{ onSeed: (r) => seen.push(r.seed) },
		);
		expect(perSeed.map((r) => r.seed)).toEqual([1, 2]);
		expect(seen.sort()).toEqual([1, 2]);
		// Nobody approached anyone: no teams, nobody placed, nothing leaked, and no trusted party involved.
		expect(row).toMatchObject({
			method: "agents",
			placed: 0,
			overall: 0,
			leakage: 0,
			central: false,
		});
	});
});
