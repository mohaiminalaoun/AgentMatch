import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { contactOf } from "../../src/engine/agent.js";
import type { BusEvent } from "../../src/engine/bus.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import type { RunEvent } from "../../src/engine/events.js";
import type { Profile } from "../../src/engine/profile.js";
import { STANDARD_REFUSAL } from "../../src/engine/proposal.js";
import { createWorld, proposalFrom, runRound } from "../../src/engine/round.js";
import { createRunLog, readRunLog } from "../../src/engine/runlog.js";
import { formatRun } from "../../src/describe.js";
import { person, sampleProfile } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// Ada (the sample profile) proposes; three people receive.
const ada = sampleProfile;
// Each receiver gets their own project idea; person() otherwise copies the sample profile's.
const withIdea = (p: Profile, title: string): Profile => ({
	...p,
	projectIdeas: [{ title, description: `${title}, as a hackathon project.` }],
});
const ben = withIdea(
	person("ben", [{ name: "backend", level: "expert" }], ["climate"], -5),
	"City emissions tracker",
);
const kemi = withIdea(
	person("kemi", [{ name: "frontend", level: "expert" }], ["education"], 1),
	"Accessible study tools",
);
const omar = withIdea(
	person("omar", [{ name: "ml", level: "expert" }], ["finance"], 5.5),
	"Open-source risk dashboard",
);

const decisions: Record<string, object> = {
	ben: { decision: "decline" },
	kemi: {
		decision: "counter",
		pitch: "Carbon tracker: Estimate a household's footprint from receipts, for schools.",
		rolesNeeded: ["design"],
	},
	omar: { decision: "accept" },
	// Ada's answer when Kemi's counter comes back to her.
	[sampleProfile.id]: { decision: "decline" },
};

// A client whose fake model decides by who is asking (found in the profile in the prompt),
// optionally after a random delay so replies finish in a random order.
// Interest checks answer "withdraw" unless `interests` says otherwise for that agent.
function fakeClient(
	randomDelays = false,
	script = decisions,
	interests: Record<string, "continue" | "withdraw"> = {},
) {
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string);
		const receiver = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
		if (randomDelays) {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.random() * 20),
			);
		}
		const isInterestCheck = messages
			.at(-1)
			.content.includes("Keep going, or withdraw?");
		const content = JSON.stringify(
			isInterestCheck
				? {
						rationale: `Private interest reasoning for ${receiver}.`,
						interest: interests[receiver] ?? "withdraw",
					}
				: {
						rationale: `Private reasoning for ${receiver}.`,
						decision: script[receiver],
					},
		);
		return new Response(
			JSON.stringify({
				choices: [{ message: { content } }],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 20,
					total_tokens: 120,
				},
			}),
		);
	}) as typeof globalThis.fetch;
	return createLlmClient(config, { fetch, retry: { sleep: async () => {} } });
}

// A world, Ada's proposals to everyone else, and a list recording every bus event.
function setup() {
	const world = createWorld([ada, ben, kemi, omar]);
	const events: BusEvent[] = [];
	world.bus.subscribe((event) => events.push(event));
	const proposals = ["ben", "kemi", "omar"].map((to, i) =>
		proposalFrom(world.agents[ada.id]!, to, `prop-${i + 1}`)!,
	);
	return { world, events, proposals };
}

// Each event as "from → to: kind", for comparing the order of events.
const summary = (events: BusEvent[]) =>
	events.map((e) =>
		e.type === "sent"
			? `${e.message.from} → ${e.message.to}: ${"kind" in e.message ? (e.message.kind === "share" ? `share ${e.message.level}` : e.message.kind === "interest" ? `${e.message.interest} ${e.message.level}` : e.message.kind) : "decision" in e.message ? e.message.decision : "proposal"}`
			: `rejected: ${e.reason}`,
	);

describe("proposalFrom", () => {
	test("pitches the proposer's first project idea and asks for the core roles they lack", () => {
		const { world } = setup();
		const proposal = proposalFrom(world.agents[ada.id]!, "ben", "prop-1");
		expect(proposal).toEqual({
			id: "prop-1",
			from: ada.id,
			to: "ben",
			pitch: "Carbon tracker: Estimate a household's footprint from receipts.",
			rolesNeeded: ["frontend", "backend", "product"],
		});
	});

	test("someone with no project idea has nothing public to pitch", () => {
		const world = createWorld([{ ...ada, projectIdeas: [] }, ben]);
		expect(
			proposalFrom(world.agents[ada.id]!, "ben", "prop-1"),
		).toBeUndefined();
	});
});

describe("runRound", () => {
	test("one proposal and its response go through the bus, in that order", async () => {
		const { world, events, proposals } = setup();
		await runRound(world, fakeClient(), [proposals[0]!]);
		expect(summary(events)).toEqual([
			`${ada.id} → ben: proposal`,
			`ben → ${ada.id}: decline`,
		]);
	});

	test("both agents remember the exchange, in order", async () => {
		const { world, proposals } = setup();
		const { world: after } = await runRound(world, fakeClient(), [
			proposals[0]!,
		]);
		const adaSide = contactOf(after.agents[ada.id]!, "ben").history;
		const benSide = contactOf(after.agents.ben!, ada.id).history;
		expect(adaSide).toEqual(benSide);
		expect(
			adaSide.map((m) => ("decision" in m ? m.decision : "proposal")),
		).toEqual(["proposal", "decline"]);
	});

	test("a decline goes out with the standard refusal", async () => {
		const { world, proposals } = setup();
		const { report } = await runRound(world, fakeClient(), [proposals[0]!]);
		expect(report[0]!.response).toMatchObject({
			decision: "decline",
			reason: STANDARD_REFUSAL,
		});
	});

	test("what each side revealed is recorded", async () => {
		const { world, proposals } = setup();
		const { world: after } = await runRound(world, fakeClient(), proposals);
		expect(contactOf(after.agents[ada.id]!, "ben").revealed).toEqual([
			"projectIdeas",
		]);
		expect(contactOf(after.agents.ben!, ada.id).revealed).toEqual([]);
		// Kemi's counter pitch repeats Ada's idea, not anything of Kemi's.
		expect(contactOf(after.agents.kemi!, ada.id).revealed).toEqual([]);
	});

	test("the private rationale is in the report but never on the bus", async () => {
		const { world, events, proposals } = setup();
		const { report } = await runRound(world, fakeClient(), proposals);
		expect(report.map((r) => r.result.rationale)).toEqual([
			"Private reasoning for ben.",
			"Private reasoning for kemi.",
			"Private reasoning for omar.",
			// Ada deciding on Kemi's counter, one tick later.
			`Private reasoning for ${ada.id}.`,
		]);
		expect(JSON.stringify(events)).not.toContain("Private reasoning");
	});

	test("the bus order is the same however the model's replies are timed", async () => {
		const orders = new Set<string>();
		for (let run = 0; run < 5; run++) {
			const { world, events, proposals } = setup();
			await runRound(world, fakeClient(true), proposals);
			orders.add(JSON.stringify(summary(events)));
		}
		expect(orders.size).toBe(1);
		expect(JSON.parse([...orders][0]!)).toEqual([
			`${ada.id} → ben: proposal`,
			`${ada.id} → kemi: proposal`,
			`${ada.id} → omar: proposal`,
			// Tick 1: everyone answers; Omar's accept opens level 1, so he shares.
			`ben → ${ada.id}: decline`,
			`kemi → ${ada.id}: counter`,
			`omar → ${ada.id}: accept`,
			`omar → ${ada.id}: share 1`,
			// Tick 2: Ada declines Kemi's counter, shares with Omar now that she's seen his accept,
			// then checks Omar's share and (by default in this fake) withdraws.
			`${ada.id} → kemi: decline`,
			`${ada.id} → omar: share 1`,
			`${ada.id} → omar: withdraw 1`,
			// Tick 3: Omar checks Ada's share and withdraws too.
			`omar → ${ada.id}: withdraw 1`,
		]);
	});

	test("every inbox is empty after the round", async () => {
		const { world, proposals } = setup();
		const { world: after } = await runRound(world, fakeClient(), proposals);
		for (const id of Object.keys(after.agents)) {
			expect(after.bus.receive(id)).toEqual([]);
		}
	});

	test("the world passed in is left unchanged", async () => {
		const { world, proposals } = setup();
		const before = JSON.stringify(world.agents);
		const { world: after } = await runRound(world, fakeClient(), proposals);
		expect(JSON.stringify(world.agents)).toBe(before);
		expect(after.agents).not.toBe(world.agents);
	});
});

describe("prompt isolation", () => {
	test("an agent's prompts never contain anyone else's private data", async () => {
		// Kemi carries unique markers in every private field; Ada's private skill is "typescript".
		const marked: Profile = {
			...kemi,
			name: "ZzKemiName",
			skills: [{ name: "zz-secret-skill", level: "expert" }],
			interests: ["zz-secret-interest"],
		};
		const world = createWorld([ada, ben, marked]);
		const promptsFor: Record<string, string[]> = {};
		// Records every prompt by who it was built for, then declines.
		const fetch = (async (_url: unknown, init?: RequestInit) => {
			const body = init!.body as string;
			const receiver = /"id": "(\w+)"/.exec(
				JSON.parse(body).messages[1].content,
			)![1]!;
			(promptsFor[receiver] ??= []).push(body);
			const content = JSON.stringify({
				rationale: "Not a fit.",
				decision: { decision: "decline" },
			});
			return new Response(
				JSON.stringify({ choices: [{ message: { content } }] }),
			);
		}) as typeof globalThis.fetch;
		const client = createLlmClient(config, { fetch });

		// Kemi is in the same round, deciding at the same time as Ben.
		const proposals = ["ben", "kemi"].map((to, i) =>
			proposalFrom(world.agents[ada.id]!, to, `prop-${i + 1}`)!,
		);
		await runRound(world, client, proposals);

		const benPrompts = promptsFor.ben!.join("\n");
		for (const secret of [
			"zz-secret-skill",
			"zz-secret-interest",
			"ZzKemiName",
		]) {
			expect(benPrompts).not.toContain(secret);
		}
		// The proposer's private data doesn't reach the receiver either, only the public pitch.
		expect(benPrompts).not.toContain("typescript");
		expect(benPrompts).toContain("Carbon tracker");
		// The test only means something if Kemi's own prompt did contain her markers.
		expect(promptsFor.kemi!.join("\n")).toContain("zz-secret-skill");
	});
});

describe("staged disclosure to level 1", () => {
	// Nia pitches an AI note-taking app; Kemi wants accessible study tools.
	const nia: Profile = {
		...withIdea(
			person(
				"nia",
				[{ name: "ml", level: "expert" }],
				["education", "accessibility"],
				0,
			),
			"AI note-taking app",
		),
		availability: { hoursPerWeek: 12, utcOffset: 0 },
	};
	const kemiCounter = {
		decision: "counter",
		pitch: "AI note-taking app focused on accessible study tools for students with dyslexia.",
		rolesNeeded: ["ml"],
	};

	// A two-person world, Nia's proposal to Kemi, and every bus event.
	function pair() {
		const world = createWorld([nia, kemi]);
		const events: BusEvent[] = [];
		world.bus.subscribe((event) => events.push(event));
		const proposal = proposalFrom(world.agents.nia!, "kemi", "prop-1")!;
		return { world, events, proposal };
	}

	test("a counter that's accepted opens level 1 for both, and each learns the other's level-1 fields", async () => {
		const { world, events, proposal } = pair();
		const client = fakeClient(false, {
			kemi: kemiCounter,
			nia: { decision: "accept" },
		});
		const { world: after, quiet } = await runRound(world, client, [
			proposal,
		]);

		expect(quiet).toBe(true);
		expect(summary(events)).toEqual([
			"nia → kemi: proposal",
			"kemi → nia: counter",
			"nia → kemi: accept",
			"nia → kemi: share 1",
			"kemi → nia: share 1",
			// Each checks the other's share; this fake withdraws by default.
			"kemi → nia: withdraw 1",
			"nia → kemi: withdraw 1",
		]);
		const niaSide = contactOf(after.agents.nia!, "kemi");
		const kemiSide = contactOf(after.agents.kemi!, "nia");
		expect([niaSide.level, kemiSide.level]).toEqual([1, 1]);
		expect(niaSide.learned).toEqual({
			interests: kemi.interests,
			availability: kemi.availability,
		});
		expect(kemiSide.learned).toEqual({
			interests: nia.interests,
			availability: nia.availability,
		});
		expect(niaSide.revealed).toEqual(
			expect.arrayContaining([
				"projectIdeas",
				"interests",
				"availability",
			]),
		);
		expect(niaSide.revealed).not.toContain("skills");
	});

	test("a proposal accepted straight away also opens level 1", async () => {
		const { world, proposal } = pair();
		const client = fakeClient(false, { kemi: { decision: "accept" } });
		const { world: after } = await runRound(world, client, [proposal]);
		expect(contactOf(after.agents.nia!, "kemi").level).toBe(1);
		expect(contactOf(after.agents.kemi!, "nia").level).toBe(1);
	});

	test("a decline shares nothing and stays at level 0", async () => {
		const { world, events, proposal } = pair();
		const client = fakeClient(false, { kemi: { decision: "decline" } });
		const { world: after } = await runRound(world, client, [proposal]);
		expect(summary(events)).toEqual([
			"nia → kemi: proposal",
			"kemi → nia: decline",
		]);
		expect(contactOf(after.agents.nia!, "kemi")).toMatchObject({
			level: 0,
			learned: {},
		});
		expect(contactOf(after.agents.kemi!, "nia")).toMatchObject({
			level: 0,
			learned: {},
		});
	});

	test("endless counters stop at maxTicks, with mail still waiting", async () => {
		const { world, proposal } = pair();
		const niaCounter = { ...kemiCounter, rolesNeeded: ["design"] };
		const client = fakeClient(false, {
			kemi: kemiCounter,
			nia: niaCounter,
		});
		const result = await runRound(world, client, [proposal], {
			maxTicks: 4,
		});
		expect(result.ticks).toBe(4);
		expect(result.quiet).toBe(false);
	});

	test("after level 1, prompts still never contain the other side's unshared fields", async () => {
		const marked: Profile = {
			...kemi,
			skills: [{ name: "zz-secret-skill", level: "expert" }],
		};
		const world = createWorld([nia, marked]);
		const prompts: string[] = [];
		const base = fakeClient(false, {
			kemi: kemiCounter,
			nia: { decision: "accept" },
		});
		const client = {
			...base,
			chatJson: ((messages, schema, options) => {
				prompts.push(JSON.stringify(messages));
				return base.chatJson(messages, schema, options);
			}) as typeof base.chatJson,
		};
		const proposal = proposalFrom(world.agents.nia!, "kemi", "prop-1")!;
		const { world: after } = await runRound(world, client, [proposal]);
		expect(contactOf(after.agents.nia!, "kemi").level).toBe(1);
		const niaPrompts = prompts.filter((p) =>
			p.includes('\\"id\\": \\"nia\\"'),
		);
		expect(niaPrompts.length).toBeGreaterThan(0);
		expect(niaPrompts.join("")).not.toContain("zz-secret-skill");
	});

	test("both continuing after each share takes them from level 0 to level 2", async () => {
		const { world, events, proposal } = pair();
		const client = fakeClient(
			false,
			{ kemi: kemiCounter, nia: { decision: "accept" } },
			{ kemi: "continue", nia: "continue" },
		);
		const { world: after, quiet } = await runRound(world, client, [
			proposal,
		]);

		expect(quiet).toBe(true);
		expect(summary(events)).toEqual([
			"nia → kemi: proposal",
			"kemi → nia: counter",
			"nia → kemi: accept",
			"nia → kemi: share 1",
			"kemi → nia: share 1",
			"kemi → nia: continue 1",
			"nia → kemi: continue 1",
			// Nia has now seen both continues: level 2 opens.
			"nia → kemi: share 2",
			"kemi → nia: share 2",
			"kemi → nia: continue 2",
			"nia → kemi: continue 2",
		]);
		const niaSide = contactOf(after.agents.nia!, "kemi");
		const kemiSide = contactOf(after.agents.kemi!, "nia");
		expect([niaSide.level, kemiSide.level]).toEqual([2, 2]);
		expect(niaSide.learned).toEqual({
			interests: kemi.interests,
			availability: kemi.availability,
			skills: kemi.skills,
			preferences: kemi.preferences,
		});
		expect(kemiSide.learned).not.toHaveProperty("name");
	});

	test("a withdrawal at level 1 ends it there: no skills are ever shared", async () => {
		const { world, events, proposal } = pair();
		const client = fakeClient(
			false,
			{ kemi: kemiCounter, nia: { decision: "accept" } },
			{ kemi: "withdraw", nia: "continue" },
		);
		const { world: after } = await runRound(world, client, [proposal]);
		expect(summary(events)).not.toContain("nia → kemi: share 2");
		expect(summary(events)).not.toContain("kemi → nia: share 2");
		expect(contactOf(after.agents.nia!, "kemi").level).toBe(1);
		expect(contactOf(after.agents.nia!, "kemi").learned).not.toHaveProperty(
			"skills",
		);
	});

	test("raising maxLevel lets a mutual continue at level 2 open level 3", async () => {
		const { world, proposal } = pair();
		const client = fakeClient(
			false,
			{ kemi: kemiCounter, nia: { decision: "accept" } },
			{ kemi: "continue", nia: "continue" },
		);
		const { world: after } = await runRound(world, client, [proposal], {
			maxLevel: 3,
		});
		expect(contactOf(after.agents.nia!, "kemi").level).toBe(3);
		expect(contactOf(after.agents.nia!, "kemi").learned.name).toBe(
			kemi.name,
		);
	});

	test("interest rationales are reported but never sent", async () => {
		const { world, events, proposal } = pair();
		const client = fakeClient(
			false,
			{ kemi: kemiCounter, nia: { decision: "accept" } },
			{ kemi: "continue", nia: "continue" },
		);
		const { interests } = await runRound(world, client, [proposal]);
		expect(
			interests.map((i) => [i.agent, i.level, i.result.interest]),
		).toEqual([
			["kemi", 1, "continue"],
			["nia", 1, "continue"],
			["kemi", 2, "continue"],
			["nia", 2, "continue"],
		]);
		expect(interests[0]!.result.rationale).toBe(
			"Private interest reasoning for kemi.",
		);
		expect(JSON.stringify(events)).not.toContain(
			"Private interest reasoning",
		);
	});

	describe("the event stream and run log", () => {
		// The full Nia-and-Kemi negotiation, recording every event.
		async function negotiate() {
			const { world, proposal } = pair();
			const events: RunEvent[] = [];
			const client = fakeClient(
				false,
				{ kemi: kemiCounter, nia: { decision: "accept" } },
				{ kemi: "continue", nia: "continue" },
			);
			await runRound(world, client, [proposal], {
				onEvent: (event) => events.push(event),
			});
			return events;
		}

		test("every kind of event appears, starting with the round", async () => {
			const events = await negotiate();
			expect(events[0]).toMatchObject({
				type: "round",
				model: "test-model",
				agents: ["kemi", "nia"],
			});
			expect(new Set(events.map((e) => e.type))).toEqual(
				new Set([
					"round",
					"tick",
					"bus",
					"decision",
					"level",
					"interest",
					"exchange",
				]),
			);
		});

		test("bus events keep the bus's own order", async () => {
			const events = await negotiate();
			const seqs = events.flatMap((e) =>
				e.type === "bus" ? [e.event.seq] : [],
			);
			expect(seqs).toEqual(seqs.map((_, i) => i + 1));
		});

		test("level changes are recorded for both sides, up to level 2", async () => {
			const events = await negotiate();
			const levels = events.flatMap((e) =>
				e.type === "level" ? [`${e.agent} ${e.from}→${e.to}`] : [],
			);
			expect(levels).toEqual([
				"nia 0→1",
				"kemi 0→1",
				"nia 1→2",
				"kemi 1→2",
			]);
		});

		test("a run written to a log reads back identical", async () => {
			const events = await negotiate();
			const dir = mkdtempSync(join(tmpdir(), "round-log-"));
			try {
				const log = createRunLog("test", dir);
				events.forEach(log.write);
				// JSON drops undefined fields, so compare through JSON on both sides.
				expect(readRunLog(log.path)).toEqual(
					JSON.parse(JSON.stringify(events)),
				);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		test("the timeline shows ticks, messages, decisions, levels, interests, and a model-call summary", async () => {
			const text = formatRun(await negotiate());
			expect(text).toContain("round · ");
			expect(text).toContain("── tick 1 ──");
			expect(text).toContain("#1 nia → kemi   proposal:");
			expect(text).toContain(
				"kemi decides counter · private: Private reasoning for kemi.",
			);
			expect(text).toContain("level: nia with kemi  1 → 2");
			expect(text).toContain("kemi at level 1 with nia: continue");
			expect(text).toMatch(/6 model calls · 720 tokens$/);
			expect(text).not.toContain("═══ model call");
			expect(formatRun(await negotiate(), { prompts: true })).toContain(
				"═══ model call 1",
			);
		});
	});
});
