import { describe, expect, test } from "vitest";
import { createAgent, raiseLevel } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import {
	commitmentMessages,
	offerMessages,
	teamVersionMessages,
} from "../../src/engine/commitment.js";
import type { Config } from "../../src/engine/config.js";
import {
	decisionMessages,
	joinRequestMessages,
} from "../../src/engine/decision.js";
import {
	brainstormMessages,
	discover,
	discoveryMessages,
} from "../../src/engine/discovery.js";
import { hunchMessages } from "../../src/engine/hunch.js";
import {
	interestMessages,
	revisionMessages,
} from "../../src/engine/interest.js";
import { listingMessages } from "../../src/engine/listing.js";
import { lockMessages } from "../../src/engine/lock.js";
import { guidance, notesFor, type Note } from "../../src/engine/notes.js";
import { JOIN_PREFIX } from "../../src/engine/proposal.js";
import { createWorld, proposalFrom, runRound } from "../../src/engine/round.js";
import { person, sampleProfile } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// One planted note per level, each worded so it can't appear by accident.
const planted: Note[] = [
	{ text: "zz-note-level0", level: 0 },
	{ text: "zz-note-level1", level: 1 },
	{ text: "zz-note-level2", level: 2 },
	{ text: "zz-note-level3", level: 3 },
	{ text: "zz-note-never", level: "never" },
];
const all = planted.map((n) => n.text);

// The planted notes that appear in `prompt`.
const seen = (prompt: unknown) =>
	all.filter((text) => JSON.stringify(prompt).includes(text));

// Ada, with the planted notes, at `level` with p9.
const ada = (level: 0 | 1 | 2) =>
	level === 0
		? createAgent(sampleProfile, planted)
		: raiseLevel(createAgent(sampleProfile, planted), "p9", level);

describe("notesFor", () => {
	test("returns the notes at or below the level, never the 'never' ones", () => {
		expect(notesFor(planted, 0)).toEqual(["zz-note-level0"]);
		expect(notesFor(planted, 2)).toEqual([
			"zz-note-level0",
			"zz-note-level1",
			"zz-note-level2",
		]);
		expect(notesFor(planted, 3)).not.toContain("zz-note-never");
	});
});

describe("each prompt holds only the notes its level allows", () => {
	const proposal = {
		id: "p1",
		from: "p9",
		to: sampleProfile.id,
		pitch: "A carbon tracker.",
		rolesNeeded: ["mobile"],
	};
	const revision = {
		kind: "revision" as const,
		from: "p9",
		to: sampleProfile.id,
		level: 1 as const,
		pitch: "A carbon tracker for schools.",
		rolesNeeded: ["mobile"],
	};

	test("listing and discovery are public: level 0 only", () => {
		expect(seen(listingMessages(ada(0)))).toEqual(["zz-note-level0"]);
		expect(seen(discoveryMessages(ada(0), [], 3))).toEqual([
			"zz-note-level0",
		]);
	});

	test("a decision uses the level with the proposer", () => {
		expect(seen(decisionMessages(ada(0), proposal))).toEqual([
			"zz-note-level0",
		]);
		expect(seen(decisionMessages(ada(1), proposal))).toEqual([
			"zz-note-level0",
			"zz-note-level1",
		]);
	});

	test("an interest check uses the level of the share just learned", () => {
		expect(seen(interestMessages(ada(0), "p9", 1))).toEqual([
			"zz-note-level0",
			"zz-note-level1",
		]);
		expect(seen(interestMessages(ada(2), "p9", 2))).toEqual([
			"zz-note-level0",
			"zz-note-level1",
			"zz-note-level2",
		]);
	});

	test("answering a revision uses the level with its sender", () => {
		expect(seen(revisionMessages(ada(1), revision))).toEqual([
			"zz-note-level0",
			"zz-note-level1",
		]);
	});

	test("offers, commitment, and the deadline use level 2", () => {
		const level2 = ["zz-note-level0", "zz-note-level1", "zz-note-level2"];
		expect(seen(offerMessages(ada(2), ["p9"], 1))).toEqual(level2);
		expect(
			seen(
				commitmentMessages(ada(2), [
					{
						kind: "offer",
						from: "p9",
						to: sampleProfile.id,
						team: "team-p9",
						pitch: "A carbon tracker.",
						rolesNeeded: ["mobile"],
					},
				]),
			),
		).toEqual(level2);
		expect(
			seen(
				lockMessages(
					ada(2),
					{
						id: "team-p9",
						members: ["p9", sampleProfile.id],
						project: { title: "Carbon", description: "A tracker." },
						rolesNeeded: ["mobile"],
						status: "tentative",
					},
					[],
					1,
				),
			),
		).toEqual(level2);
	});

	test("'never' notes are in no prompt at all", () => {
		for (const level of [0, 1, 2] as const) {
			expect(seen(decisionMessages(ada(level), proposal))).not.toContain(
				"zz-note-never",
			);
		}
		expect(seen(interestMessages(ada(2), "p9", 2))).not.toContain(
			"zz-note-never",
		);
	});
});

describe("in a live run", () => {
	// A fake model that records every prompt by which agent it was for, accepting and continuing throughout.
	function recordingClient() {
		const prompts: Record<string, string[]> = {};
		const fetch = (async (_url: unknown, init?: RequestInit) => {
			const { messages } = JSON.parse(init!.body as string);
			const who = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
			(prompts[who] ??= []).push(JSON.stringify(messages));
			const last: string = messages.at(-1).content;
			const reply = last.includes("What's your steer?")
				? {
						rationale: "Nothing private bears on it.",
						steer: "neutral",
						riskArea: null,
					}
				: last.includes("Keep going, or withdraw?")
					? { rationale: "Fits.", interest: "continue" }
					: last.startsWith("Public board:")
						? { rationale: "None.", approach: [] }
						: {
								rationale: "Fits.",
								decision: { decision: "accept" },
							};
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

	test("another agent's prompts never contain your notes, at any level", async () => {
		const omar = {
			...person(
				"omar",
				[{ name: "ml", level: "expert" }],
				["finance"],
				5.5,
			),
			projectIdeas: [
				{ title: "Risk dashboard", description: "A dashboard." },
			],
		};
		const world = createWorld([sampleProfile, omar], {
			[sampleProfile.id]: planted,
		});
		const { client, prompts } = recordingClient();
		await discover(client, world);
		await runRound(world, client, [
			proposalFrom(world.agents[sampleProfile.id]!, "omar", "p1")!,
		]);
		expect(prompts.omar!.length).toBeGreaterThan(2);
		for (const prompt of prompts.omar!) {
			expect(seen(prompt)).toEqual([]);
		}
		// Ada's prompts that write anything reached level 2, so they hold her notes up to there. Her private
		// hunch calls see every note, but their output is only a steer from a fixed list.
		const hunch = (prompt: string) => prompt.includes("What's your steer?");
		const writing = prompts[sampleProfile.id]!.filter((p) => !hunch(p));
		expect(writing.join("\n")).toContain("zz-note-level2");
		expect(writing.join("\n")).not.toContain("zz-note-level3");
		expect(writing.join("\n")).not.toContain("zz-note-never");
		expect(prompts[sampleProfile.id]!.some(hunch)).toBe(true);
	});

	test("another agent's prompts, bus messages, listings, and shares never contain your instructions", async () => {
		const marker = "zz-instruction-marker";
		const omar = {
			...person(
				"omar",
				[{ name: "ml", level: "expert" }],
				["finance"],
				5.5,
			),
			projectIdeas: [
				{ title: "Risk dashboard", description: "A dashboard." },
			],
		};
		const world = createWorld(
			[sampleProfile, omar],
			{ [sampleProfile.id]: planted },
			{ [sampleProfile.id]: marker },
		);
		const { client, prompts } = recordingClient();
		await discover(client, world);
		const after = await runRound(world, client, [
			proposalFrom(world.agents[sampleProfile.id]!, "omar", "p1")!,
		]);
		expect(prompts.omar!.length).toBeGreaterThan(2);
		for (const prompt of prompts.omar!) {
			expect(prompt).not.toContain(marker);
		}
		const hunch = (prompt: string) => prompt.includes("What's your steer?");
		const writing = prompts[sampleProfile.id]!.filter((p) => !hunch(p));
		expect(writing.join("\n")).toContain(marker);
		expect(prompts[sampleProfile.id]!.some(hunch)).toBe(true);
		expect(
			prompts[sampleProfile.id]!.filter(hunch).join("\n"),
		).not.toContain(marker);
		const sent = JSON.stringify(
			Object.values(after.world.agents).flatMap((agent) => [
				agent.listing,
				...Object.values(agent.contacts).flatMap((c) => c.history),
			]),
		);
		expect(sent).not.toContain(marker);
	});
});

describe("standing guidance", () => {
	const marker = "zz-instruction-marker";
	const proposal = {
		id: "p1",
		from: "p9",
		to: sampleProfile.id,
		pitch: "A carbon tracker.",
		rolesNeeded: ["mobile"],
	};
	const join = {
		...proposal,
		pitch: `${JOIN_PREFIX}A carbon tracker.`,
		join: true as const,
	};
	const revision = {
		kind: "revision" as const,
		from: "p9",
		to: sampleProfile.id,
		level: 1 as const,
		pitch: "A carbon tracker for schools.",
		rolesNeeded: ["mobile"],
	};
	const offer = {
		kind: "offer" as const,
		from: "p9",
		to: sampleProfile.id,
		team: "team-p9",
		pitch: "A carbon tracker.",
		rolesNeeded: ["mobile"],
	};
	const team = {
		id: "team-p9",
		members: ["p9", sampleProfile.id],
		project: { title: "Carbon", description: "A tracker." },
		rolesNeeded: ["mobile"],
		status: "tentative" as const,
	};

	const promptsOf = (agent: ReturnType<typeof createAgent>) => ({
		listing: listingMessages(agent),
		discovery: discoveryMessages(agent, [], 3),
		brainstorm: brainstormMessages(
			agent,
			[{ id: "p9", rolesNeeded: ["ml"] }],
			3,
		),
		decision: decisionMessages(agent, proposal),
		join: joinRequestMessages(agent, join),
		interest: interestMessages(agent, "p9", 1),
		revision: revisionMessages(agent, revision),
		offer: offerMessages(agent, ["p9"], 1),
		commitment: commitmentMessages(agent, [offer]),
		teamVersion: teamVersionMessages(agent, ["p9"], {}),
		lock: lockMessages(agent, team, [], 1),
	});

	test("guidance is empty without instructions, and a labeled private block with them", () => {
		expect(guidance(createAgent(sampleProfile))).toBe("");
		expect(guidance(createAgent(sampleProfile, [], marker))).toContain(
			marker,
		);
		expect(guidance(createAgent(sampleProfile, [], marker))).toContain(
			"standing guidance",
		);
		expect(guidance(createAgent(sampleProfile, [], marker))).toContain(
			"must not quote or describe it",
		);
	});

	test("every aboutHuman call includes the block when set, and is unchanged when unset", () => {
		const none = promptsOf(createAgent(sampleProfile));
		const unset = promptsOf(createAgent(sampleProfile, [], undefined));
		const guided = promptsOf(createAgent(sampleProfile, [], marker));
		expect(unset).toEqual(none);
		for (const [kind, messages] of Object.entries(none)) {
			expect(JSON.stringify(messages), kind).not.toContain(marker);
			expect(JSON.stringify(messages), kind).not.toContain(
				"standing guidance",
			);
			expect(
				JSON.stringify(guided[kind as keyof typeof guided]),
			).toContain(marker);
		}
	});

	test("the hunch call never sees instructions", () => {
		expect(
			JSON.stringify(
				hunchMessages(
					createAgent(sampleProfile, planted, marker),
					"p9",
					"A carbon tracker.",
				),
			),
		).not.toContain(marker);
	});
});
