import { expect, test } from "vitest";
import { Team } from "../../src/engine/team.js";

const team = {
	id: "team-1",
	members: ["p1", "p2", "p3"],
	project: {
		title: "Carbon tracker",
		description: "Estimate a household's footprint from receipts.",
	},
	rolesNeeded: ["design"],
	status: "tentative",
};

test("a valid team parses", () => {
	expect(Team.safeParse(team).success).toBe(true);
});

test("a committed team parses", () => {
	expect(Team.safeParse({ ...team, status: "committed" }).success).toBe(true);
});

test("a team of one fails", () => {
	expect(Team.safeParse({ ...team, members: ["p1"] }).success).toBe(false);
});

test("a team with a duplicate member fails", () => {
	const result = Team.safeParse({ ...team, members: ["p1", "p2", "p1"] });
	expect(result.success).toBe(false);
});

test("an unknown status fails", () => {
	expect(Team.safeParse({ ...team, status: "pending" }).success).toBe(false);
});
