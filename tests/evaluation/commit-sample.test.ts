import { describe, expect, test } from "vitest";
import { AgentCommitment } from "../../src/engine/commitment.js";
import {
	commitSampleProblems,
	commitSampleRequest,
} from "../../src/evaluation/commit-sample.js";

describe("commitSampleRequest", () => {
	const r = commitSampleRequest("muse", 1_000_000);

	test("is a level-2 commit request for the agent, due in three hours", () => {
		expect(r).toMatchObject({ agent: "muse", kind: "commit", level: 2 });
		expect(r.id).toMatch(/^seed-muse-commit-/);
		expect(new Date(r.deadline).getTime()).toBe(
			1_000_000 + 3 * 60 * 60_000,
		);
	});

	test("carries the engine's commit prompt with both offers and the mailbox preface", () => {
		expect(r.prompt).toContain(
			"You are answering for your human in Agent Match",
		);
		expect(r.prompt).toContain(
			"have offered your human a place on their team",
		);
		expect(r.prompt).toContain("Option p-owner-a");
		expect(r.prompt).toContain("Option p-owner-b");
		expect(r.prompt).toContain("or use null to decline them all");
	});

	test("its reply schema asks for a rationale and a nullable commit, and null is a valid answer", () => {
		const props = (r.replySchema as { properties: Record<string, unknown> })
			.properties;
		expect(Object.keys(props).sort()).toEqual(["commit", "rationale"]);
		expect(
			AgentCommitment.safeParse({ rationale: "unsure", commit: null })
				.success,
		).toBe(true);
		expect(
			AgentCommitment.safeParse({
				rationale: "join A",
				commit: "p-owner-a",
			}).success,
		).toBe(true);
	});

	test("uses made-up people only", () => {
		expect(r.prompt).not.toMatch(/p-bwwbwk|p-nafisa|p-sammy|p-travis/);
	});
});

describe("commit-fit variant", () => {
	const fit = commitSampleRequest("muse", 1_000_000, "fit");

	test("leads with an open-source developer-tools offer on a team of three, and is told apart by its id", () => {
		expect(fit.id).toMatch(/^seed-muse-commit-fit-/);
		expect(fit.id).toContain("-commit-");
		expect(fit.prompt).toContain("Dev Tool Dojo");
		expect(fit.prompt).toContain("open-source");
		expect(fit.prompt).toContain("(3 people now");
	});

	test("the default stays the mixed pair", () => {
		const mixed = commitSampleRequest("muse", 1_000_000);
		expect(mixed.prompt).toContain("Habit Nudge");
		expect(mixed.prompt).not.toContain("Dev Tool Dojo");
	});
});

describe("commitSampleProblems", () => {
	test("accepts null and either owner offered", () => {
		expect(commitSampleProblems({ rationale: "x", commit: null })).toEqual(
			[],
		);
		expect(
			commitSampleProblems({ rationale: "x", commit: "p-owner-a" }),
		).toEqual([]);
		expect(
			commitSampleProblems({ rationale: "x", commit: "p-owner-b" }),
		).toEqual([]);
	});

	test("refuses an owner that was not offered, and a reply with the wrong shape", () => {
		expect(
			commitSampleProblems({ rationale: "x", commit: "p-nobody" })[0],
		).toContain("commit must be");
		expect(commitSampleProblems({ rationale: "x" })).not.toEqual([]);
		expect(
			commitSampleProblems({ decision: { decision: "accept" } }),
		).not.toEqual([]);
	});
});
