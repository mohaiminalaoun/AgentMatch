import { describe, expect, test } from "vitest";
import {
	repairSampleProblems,
	repairSampleRequest,
} from "../../src/evaluation/repair-sample.js";

const good = {
	rationale: "Drop the design work; keep the reminders.",
	revision: {
		title: "Habit Nudge",
		pitch: "A reminder service that sends scheduled nudges to build small health habits.",
		problem: "People forget small health habits without a gentle nudge.",
		build: "A web service with scheduled reminders and a plain settings page.",
		rolesNeeded: ["devops"],
		roleWork: { devops: "deploy the reminder service and its scheduler" },
	},
	removedWork: [
		{
			role: "design",
			change: "The animated companion is cut; reminders arrive as plain text messages.",
		},
	],
};
const with_ = (change: (r: typeof good) => void) => {
	const copy = structuredClone(good);
	change(copy);
	return copy;
};

describe("repairSampleRequest", () => {
	const r = repairSampleRequest("muse", 1_000_000);

	test("is a level-2 repair request for the agent, built from the engine's repair prompt", () => {
		expect(r).toMatchObject({ agent: "muse", kind: "repair", level: 2 });
		expect(r.id).toMatch(/^seed-muse-repair-/);
		expect(r.prompt).toContain(
			"bounded opportunity to repair an incomplete team's scope",
		);
		expect(r.prompt).toContain("rolesStillNeeded");
		expect(r.prompt).toContain('"design"');
	});

	test("its reply schema is the engine's repair proposal", () => {
		const props = (r.replySchema as { properties: Record<string, unknown> })
			.properties;
		expect(Object.keys(props).sort()).toEqual(
			["removedWork", "revision", "rationale"].sort(),
		);
	});

	test("uses made-up people only", () => {
		expect(r.prompt).not.toMatch(/p-bwwbwk|p-nafisa|p-sammy|p-travis/);
	});
});

describe("repairSampleProblems applies the arena's own repair rules", () => {
	test("accepts a repair that drops the uncovered design role and talks only about the project", () => {
		expect(repairSampleProblems("muse", good)).toEqual([]);
	});

	test("refuses the wording that got an outside agent's repair rejected: people and personal claims", () => {
		for (const word of [
			"owner",
			"team members",
			"our",
			"they",
			"human",
			"teammate",
		]) {
			const reply = with_((r) => {
				r.revision.build = `A web service that ${word} can use to set up scheduled reminders.`;
			});
			expect(repairSampleProblems("muse", reply), word).toContain(
				"Repairs must describe project work, not people or personal claims",
			);
		}
	});

	test("refuses a repair that adds a role, or does not explain the removed one", () => {
		const added = with_((r) => {
			r.revision.rolesNeeded = ["devops", "ml"];
			r.revision.roleWork = {
				...r.revision.roleWork,
				ml: "train a model",
			} as never;
		});
		expect(repairSampleProblems("muse", added)).toContain(
			"A repair may not add new required roles",
		);
		const unexplained = with_((r) => {
			r.removedWork = [];
		});
		expect(repairSampleProblems("muse", unexplained)).toContain(
			"Explain the actual work change for exactly every removed role",
		);
	});

	test("a reply with the wrong shape is a problem, not a crash", () => {
		expect(
			repairSampleProblems("muse", { decision: "accept" }),
		).not.toEqual([]);
		expect(repairSampleProblems("muse", "just words")).not.toEqual([]);
	});
});
