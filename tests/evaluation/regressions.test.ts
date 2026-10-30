import { describe, expect, test } from "vitest";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import { JOIN_PREFIX } from "../../src/engine/proposal.js";
import {
	caseJudgeMessages,
	REGRESSION_CASES,
	runCase,
} from "../../src/evaluation/regressions.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// A fake model: the nth agent call gets a reply that fits any of the case schemas, with rationale "Because n.",
// and the judge answers about it with `answers[n - 1]` (or `answers[0]` past the end), where "invalid" never
// parses.
function fakeClient(answers: ("yes" | "no" | "invalid")[] = ["no"]) {
	let agentCalls = 0;
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string) as {
			messages: { content: string }[];
		};
		const text = messages.map((m) => m.content).join("\n");
		const judged = text.match(/Its rationale: Because (\d+)\./)?.[1];
		const answer = judged
			? (answers[Number(judged) - 1] ?? answers[0]!)
			: undefined;
		const content =
			answer === undefined
				? JSON.stringify({
						decision: { decision: "accept" },
						interest: "continue",
						commit: null,
						rationale: `Because ${++agentCalls}.`,
					})
				: answer === "invalid"
					? "not json"
					: JSON.stringify({ answer, quote: "q" });
		return new Response(
			JSON.stringify({ choices: [{ message: { content } }] }),
		);
	}) as typeof globalThis.fetch;
	return createLlmClient(config, {
		fetch,
		retry: { sleep: async () => {} },
	});
}

const byName = (name: string) => REGRESSION_CASES.find((c) => c.name === name)!;

describe("regression cases", () => {
	test("every case runs on the engine's real prompts and asks the judge its question", async () => {
		for (const c of REGRESSION_CASES) {
			const run = await c.run(fakeClient());
			expect(run.prompt.length).toBeGreaterThan(0);
			expect(run.rationale).toBe("Because 1.");
			const [system, user] = caseJudgeMessages(c.question, run);
			expect(system!.content).toContain(c.question);
			expect(user!.content).toContain("Its rationale: Because 1.");
		}
	});

	test("each scenario puts the agent where the failure happened", async () => {
		const text = async (name: string) =>
			(await byName(name).run(fakeClient())).prompt
				.map((m) => m.content)
				.join("\n");
		expect(await text("join request")).toContain(JOIN_PREFIX);
		expect(await text("invented scheduling")).toContain("now at level 1");
		expect(await text("relabeled roles")).toContain("now at level 2");
		const offers = await text("misdescribed option");
		expect(offers).toContain("smart AI suggestions");
		expect(offers).toContain("diagnoses the likely root cause");
	});
});

describe("runCase", () => {
	test("counts the judge's yes answers as failures, and runs it couldn't judge as errors", async () => {
		const client = fakeClient(["yes", "no", "invalid", "no"]);
		const result = await runCase(client, byName("headcount"), 4);
		expect(result).toEqual({
			name: "headcount",
			runs: 3,
			failed: 1,
			errors: 1,
			examples: [{ decision: "accept", quote: "q" }],
		});
	});
});
