import { describe, expect, test } from "vitest";
import { contactOf } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import type { RunEvent } from "../../src/engine/events.js";
import type { Profile } from "../../src/engine/profile.js";
import { runSimulation, summarize } from "../../src/engine/simulation.js";
import { person } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// A person with one skill and one project idea, or no idea if `title` is undefined.
function agent(id: string, skill: string, title?: string): Profile {
	return {
		...person(id, [{ name: skill, level: "expert" }], ["education"], 0),
		projectIdeas: title
			? [{ title, description: `${title}, as a project.` }]
			: [],
	};
}

// a pitches an AI tutor; b and d are approached; c approaches but nobody approaches c; e has no idea.
const profiles = [
	agent("a", "ml", "AI tutor"),
	agent("b", "frontend", "Quiz app"),
	agent("c", "design", "Poster maker"),
	agent("d", "backend", "Grade tracker"),
	agent("e", "product"),
];

// Every person() prefers backend (copied from the sample profile), so no listing may ask for it.
const listings: Record<string, string[]> = {
	// b fills frontend in round 1; e fills product in round 2.
	a: ["frontend", "product", "data"],
	b: ["design"],
	c: ["frontend"],
	d: ["frontend"],
};
// Discovery picks per round.
const picks: Record<number, Record<string, string[]>> = {
	1: { a: ["b"], c: ["d"] },
	// b is on a's team now, so off the board. d picks c, but they've talked already, so it's skipped;
	// e asks to join a's project.
	2: { d: ["c"], e: ["a"] },
};
const decisions: Record<string, object> = {
	b: { decision: "accept" },
	d: { decision: "decline" },
	a: { decision: "accept" },
};

// A fake model that recognizes each kind of prompt and answers from the scripts above. Offers are always
// taken (the first owner offering is committed to), and members always stay when their team grows.
function fakeClient(script: typeof picks = picks) {
	// `script[n]` is what each agent picks the n-th time it's asked (its round, unless it was skipped).
	const discoveryCalls: Record<string, number> = {};
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string);
		const who = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
		const last: string = messages.at(-1).content;
		let reply: object;
		if (last === "Write the listing.") {
			reply = {
				rationale: "Listing.",
				pitch: profiles.find((p) => p.id === who)!.projectIdeas[0]!
					.title,
				rolesNeeded: listings[who],
			};
		} else if (last.startsWith("Public board:")) {
			const round = (discoveryCalls[who] =
				(discoveryCalls[who] ?? 0) + 1);
			reply = {
				rationale: "Picks.",
				approach: script[round]?.[who] ?? [],
			};
		} else if (last.startsWith("Your teammates")) {
			reply = { rationale: "Still a fit.", decision: "stay" };
		} else if (last.startsWith("Offers:")) {
			const [first] = JSON.parse(last.slice("Offers:".length));
			reply = { rationale: "Joining.", commit: first.owner };
		} else if (last.includes("Keep going, or withdraw?")) {
			reply = { rationale: "Fits.", interest: "continue" };
		} else {
			reply = { rationale: "Decided.", decision: decisions[who] };
		}
		return new Response(
			JSON.stringify({
				choices: [{ message: { content: JSON.stringify(reply) } }],
				usage: {
					prompt_tokens: 90,
					completion_tokens: 10,
					total_tokens: 100,
				},
			}),
		);
	}) as typeof globalThis.fetch;
	return createLlmClient(config, { fetch, retry: { sleep: async () => {} } });
}

// Runs the scripted two-round simulation, recording every event and progress line.
async function simulate(maxRounds = 2, script = picks) {
	const events: RunEvent[] = [];
	const phases: string[] = [];
	const world = await runSimulation(fakeClient(script), profiles, {
		maxRounds,
		onEvent: (e) => events.push(e),
		onPhase: (line) => phases.push(line),
	});
	return { world, events, phases, summary: summarize(world, events) };
}

describe("runSimulation", () => {
	test("runs listings, then discovery and negotiation for each round", async () => {
		const { phases } = await simulate();
		expect(phases).toEqual([
			"listings written: 4",
			"round 1: 2 picks → 2 proposals",
			expect.stringMatching(
				/^round 1: conversations finished in \d+ ticks$/,
			),
			"round 1: 1 offers → 1 commits in 2 passes · teams: 1",
			"round 2: 1 picks → 1 proposals",
			expect.stringMatching(
				/^round 2: conversations finished in \d+ ticks$/,
			),
			"round 2: 1 offers → 1 commits in 2 passes · teams: 1",
		]);
	});

	test("round 2 never re-proposes to someone already talked to, and ids don't collide", async () => {
		const { events } = await simulate();
		const proposals = events.flatMap((e) =>
			e.type === "bus" &&
			e.event.type === "sent" &&
			!("decision" in e.event.message) &&
			!("kind" in e.event.message)
				? [e.event.message.id]
				: [],
		);
		expect(proposals).toEqual(["r1-a-b", "r1-c-d", "r2-e-a"]);
	});

	test("conversations between different pairs stay independent", async () => {
		const { world } = await simulate();
		// a and b, then a and e, became teammates, so they're at level 3.
		expect(contactOf(world.agents.a!, "b").level).toBe(3);
		expect(contactOf(world.agents.c!, "d").level).toBe(0);
		expect(contactOf(world.agents.a!, "e").level).toBe(3);
	});
});

describe("stopping", () => {
	test("at the round limit, the run says so", async () => {
		const { events, summary } = await simulate(2);
		expect(events.at(-1)).toEqual({
			type: "stopped",
			rounds: 2,
			reason: "limit",
		});
		expect(summary.stopped).toEqual({ rounds: 2, reason: "limit" });
	});

	test("with room to go on, it stops by itself after a round that changes nothing", async () => {
		const { summary } = await simulate(6);
		// Round 3: nobody has anyone new to approach, and no team changes.
		expect(summary.stopped).toEqual({ rounds: 3, reason: "stable" });
		expect(summary.rounds).toHaveLength(3);
	});

	test("an agent that picked nobody isn't asked again while the board hasn't changed", async () => {
		// Round 1: only c approaches anyone (d, who declines), so no team forms and the board stays the same.
		const { events, phases, summary } = await simulate(6, {
			1: { c: ["d"] },
		});
		// All 5 are asked in round 1; in round 2, only c, the one who picked someone.
		expect(events.filter((e) => e.type === "discovery")).toHaveLength(
			5 + 1,
		);
		expect(phases).toContain(
			"round 2: 0 picks → 0 proposals · 4 not asked (board unchanged)",
		);
		expect(summary.stopped).toEqual({ rounds: 2, reason: "stable" });
	});
});

describe("summarize", () => {
	test("counts picks and proposals per round", async () => {
		const { summary } = await simulate();
		expect(summary.rounds).toEqual([
			{ round: 1, picks: 2, proposals: 2, offers: 1, commits: 1 },
			{ round: 2, picks: 1, proposals: 1, offers: 1, commits: 1 },
		]);
	});

	test("reports every pair's outcome", async () => {
		const { summary } = await simulate();
		expect(summary.pairs).toEqual([
			{ pair: ["a", "b"], level: 3, ready: true, ended: false },
			{ pair: ["a", "e"], level: 3, ready: true, ended: false },
			{ pair: ["c", "d"], level: 0, ready: false, ended: true },
		]);
	});

	test("finds agents nobody approached and agents in no conversation", async () => {
		const { summary } = await simulate();
		expect(summary.neverApproached).toEqual(["c", "e"]);
		expect(summary.noConversation).toEqual([]);
	});

	test("reports the committed teams and who is on none", async () => {
		const { summary, world, events } = await simulate();
		// b was on a's team before e joined, so b re-checked, and stayed.
		expect(
			events.filter((e) => e.type === "recheck").map((e) => e.agent),
		).toEqual(["b"]);
		expect(summary.departures).toBe(0);
		expect(summary.teams.map((t) => t.members)).toEqual([["a", "b", "e"]]);
		expect(summary.unplaced).toEqual(["c", "d"]);
		// b and e never talked, but as teammates they know each other's names.
		expect(contactOf(world.agents.b!, "e").learned.name).toBe(
			profiles.find((p) => p.id === "e")!.name,
		);
		// Swapping names isn't a conversation, so b and e aren't a pair.
		expect(summary.pairs.map((p) => p.pair.join("–"))).not.toContain("b–e");
	});

	test("checks each team's roles and size", async () => {
		const { summary } = await simulate();
		expect(summary.teamChecks).toEqual([
			{
				team: "team-a",
				project: "AI tutor",
				reshaped: false,
				covered: ["frontend", "product"],
				missing: ["data"],
				belowMinimum: false,
			},
		]);
	});

	test("counts roles beyond the core four on the board", async () => {
		const { summary } = await simulate();
		expect(summary.listings).toBe(4);
		expect(summary.nonCoreRoles).toEqual({ data: 1 });
	});

	test("counts model calls and tokens from the events", async () => {
		const { summary, events } = await simulate();
		const calls = events.filter((e) => e.type === "exchange").length;
		expect(summary.calls).toBe(calls);
		expect(summary.usage).toMatchObject({
			input: calls * 90,
			output: calls * 10,
			total: calls * 100,
		});
		expect(summary.fallbacks).toBe(0);
	});

	test("the same scripted run gives the same summary every time", async () => {
		const first = (await simulate()).summary;
		const second = (await simulate()).summary;
		expect(second).toEqual(first);
	});
});
