import { describe, expect, test } from "vitest";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import type { RunEvent } from "../../src/engine/events.js";
import {
	agreement,
	callOf,
	explainedCalls,
	formatExplainTable,
	judgeCalls,
	judgeMessages,
	labelSample,
	sampleCalls,
	summarizeJudgments,
	type Claim,
	type ExplainedCall,
	type JudgmentFile,
	type Labels,
} from "../../src/evaluation/explain.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

const FORMAT = "Reply with one JSON object and nothing else.";

// An exchange as a run log records it: the format instruction, the agent's prompt, and its reply.
function exchange(
	system: string,
	user: string,
	reply: object | string,
): RunEvent {
	return {
		type: "exchange",
		time: "2026-10-30T00:00:00.000Z",
		messages: [
			{ role: "system", content: FORMAT },
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		reply: typeof reply === "string" ? reply : JSON.stringify(reply),
	};
}

const profile = (id: string) =>
	`Your human's full profile (private; for your judgment only):\n${JSON.stringify({ id }, null, 2)}`;

const decision = exchange(
	profile("p3"),
	"Agent p7 proposes:\nPitch: A travel app.",
	{ decision: "accept", rationale: "Same time zone, so full overlap." },
);
const interest = exchange(
	profile("p7"),
	"What agent p3 has shared with you so far: {}\nKeep going, or withdraw?",
	{ interest: "continue", rationale: "Shares travel." },
);

describe("callOf", () => {
	test("finds the agent past the format instruction, and the kind from the prompt's wording", () => {
		expect(callOf(decision as never)).toEqual({
			agent: "p3",
			kind: "decision",
		});
		expect(callOf(interest as never)).toEqual({
			agent: "p7",
			kind: "interest check",
		});
	});

	test("an unrecognized prompt is another call, with no agent if no profile", () => {
		expect(callOf(exchange("Hello", "Hi", "{}") as never)).toEqual({
			agent: undefined,
			kind: "other call",
		});
	});
});

describe("explainedCalls", () => {
	test("keeps calls whose reply has a rationale, without the format instruction", () => {
		const events: RunEvent[] = [
			{ type: "tick", n: 1 },
			decision,
			exchange(profile("p1"), "Write the listing.", { pitch: "x" }),
			exchange(profile("p1"), "Write the listing.", "not json"),
			interest,
		];
		const calls = explainedCalls(events);
		expect(calls.map((c) => [c.index, c.kind, c.rationale])).toEqual([
			[1, "decision", "Same time zone, so full overlap."],
			[4, "interest check", "Shares travel."],
		]);
		expect(calls[0]!.prompt.some((m) => m.content === FORMAT)).toBe(false);
	});
});

describe("sampleCalls", () => {
	const calls: ExplainedCall[] = Array.from({ length: 12 }, (_, i) => ({
		index: i,
		agent: `p${i}`,
		kind: i % 3 === 0 ? "decision" : "interest check",
		prompt: [],
		rationale: "r",
	}));

	test("takes at most the limit of each kind, in log order", () => {
		const picked = sampleCalls(calls, 2, 1);
		expect(picked.filter((c) => c.kind === "decision")).toHaveLength(2);
		expect(picked.filter((c) => c.kind === "interest check")).toHaveLength(
			2,
		);
		const indexes = picked.map((c) => c.index);
		expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
	});

	test("a kind with fewer calls than the limit is taken whole", () => {
		expect(sampleCalls(calls, 20, 1)).toHaveLength(12);
	});

	test("the same seed picks the same calls", () => {
		expect(sampleCalls(calls, 3, 7)).toEqual(sampleCalls(calls, 3, 7));
	});
});

describe("judgeMessages", () => {
	test("gives the judge the agent's prompt and its rationale, and keeps unsupported apart from contradicted", () => {
		const [call] = explainedCalls([decision]);
		const [system, user] = judgeMessages(call!);
		expect(system!.content).toContain("unsupported");
		expect(system!.content).toContain("contradicted");
		expect(user!.content).toContain("Agent p7 proposes:");
		expect(user!.content).toContain("Same time zone, so full overlap.");
		expect(user!.content).not.toContain(FORMAT);
		expect(system!.content).toContain('"Join your project:"');
	});
});

const claim = (
	verdict: Claim["verdict"],
	stance: Claim["stance"] = "asserted",
	category: Claim["category"] = null,
): Claim => ({ claim: "c", verdict, stance, category, evidence: "e" });

describe("judgeCalls", () => {
	test("returns each judgment, and counts a call whose judgment never comes back valid", async () => {
		let n = 0;
		const fetch = (async () => {
			n++;
			const content =
				n === 1
					? JSON.stringify({ claims: [claim("unsupported")] })
					: "not json";
			return new Response(
				JSON.stringify({ choices: [{ message: { content } }] }),
			);
		}) as typeof globalThis.fetch;
		const client = createLlmClient(
			{ ...config, maxConcurrency: 1 },
			{ fetch, retry: { sleep: async () => {} } },
		);
		const calls = explainedCalls([decision, interest]);
		const { judged, failed } = await judgeCalls(client, calls);
		expect(judged).toHaveLength(1);
		expect(judged[0]!.judgment.claims[0]!.verdict).toBe("unsupported");
		expect(failed).toBe(1);
	});
});

describe("summarizeJudgments", () => {
	test("counts each verdict per kind, separately, with asserted ones and categories", () => {
		const summaries = summarizeJudgments([
			{
				kind: "decision",
				claims: [
					claim("supported"),
					claim("unsupported", "asserted", "invented scheduling"),
					claim(
						"contradicted",
						"tentative",
						"misdescribes an option",
					),
				],
			},
			{ kind: "interest check", claims: [claim("supported")] },
		]);
		expect(summaries).toEqual([
			{
				kind: "decision",
				calls: 1,
				claims: 3,
				supported: 1,
				unsupported: 1,
				contradicted: 1,
				assertedUnsupported: 1,
				assertedContradicted: 0,
				callsWithContradiction: 1,
				categories: {
					"invented scheduling": 1,
					"misdescribes an option": 1,
				},
			},
			expect.objectContaining({
				kind: "interest check",
				supported: 1,
				callsWithContradiction: 0,
			}),
		]);
		const table = formatExplainTable(summaries);
		expect(table).toContain("Contradicted");
		expect(table.split("\n").at(-1)).toMatch(/^all\s+2\s+4\s+50%/);
	});
});

describe("labelSample", () => {
	const file: JudgmentFile = {
		log: "x.jsonl",
		judge: "test-model",
		perKind: 5,
		seed: 1,
		judged: [
			{
				index: 3,
				kind: "decision",
				rationale: "r1",
				claims: [
					claim("unsupported"),
					claim("contradicted"),
					claim("supported"),
				],
			},
			{
				index: 9,
				kind: "interest check",
				rationale: "r2",
				claims: [
					claim("supported"),
					claim("supported"),
					claim("supported"),
				],
			},
		],
	};

	test("takes up to half flagged claims, fills the rest with supported ones, and is repeatable", () => {
		const items = labelSample(file, 4, 1);
		expect(items).toHaveLength(4);
		expect(
			items.filter((i) => i.judge.verdict !== "supported"),
		).toHaveLength(2);
		expect(labelSample(file, 4, 1)).toEqual(items);
		expect(new Set(items.map((i) => i.id)).size).toBe(4);
	});

	test("asks for more than there are and gets them all", () => {
		expect(labelSample(file, 50, 1)).toHaveLength(6);
	});
});

describe("agreement", () => {
	const item = (id: string, verdict: Claim["verdict"]) => ({
		id,
		index: 0,
		kind: "decision",
		rationale: "r",
		claim: id,
		judge: { verdict, stance: "asserted" as const },
	});
	const items = [
		item("a", "supported"),
		item("b", "supported"),
		item("c", "unsupported"),
		item("d", "contradicted"),
		item("e", "unsupported"),
	];
	const labels = (verdicts: Record<string, Claim["verdict"]>): Labels => ({
		source: "x.explain.json",
		count: 5,
		seed: 1,
		labels: Object.fromEntries(
			Object.entries(verdicts).map(([id, verdict]) => [id, { verdict }]),
		),
	});

	test("perfect agreement has kappa 1 and full precision and recall", () => {
		const a = agreement(
			items,
			labels({
				a: "supported",
				b: "supported",
				c: "unsupported",
				d: "contradicted",
				e: "unsupported",
			}),
		);
		expect(a.agreement).toBe(1);
		expect(a.kappa).toBe(1);
		expect(a.flagPrecision).toBe(1);
		expect(a.flagRecall).toBe(1);
		expect(a.disagreements).toEqual([]);
	});

	test("counts only labelled items, and lists each disagreement", () => {
		const a = agreement(
			items,
			labels({ a: "unsupported", c: "unsupported", d: "unsupported" }),
		);
		expect(a.items).toBe(3);
		expect(a.agreement).toBeCloseTo(1 / 3);
		// The judge flagged c and d; the person flagged a, c, and d.
		expect(a.flagPrecision).toBe(1);
		expect(a.flagRecall).toBeCloseTo(2 / 3);
		expect(a.confusion.unsupported).toEqual({
			supported: 1,
			unsupported: 1,
			contradicted: 1,
		});
		expect(a.disagreements.map((d) => [d.item.id, d.person])).toEqual([
			["a", "unsupported"],
			["d", "unsupported"],
		]);
	});
});
