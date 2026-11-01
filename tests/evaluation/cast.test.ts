import { describe, expect, test } from "vitest";
import {
	CAST,
	castProfiles,
	CLUSTERS,
	EXPECTED_FOR_AGENT_RELIABILITY,
	EXPECTED_GROUPS,
	judgeTeam,
} from "../../src/evaluation/cast.js";

describe("the cast", () => {
	test("30 people with unique ids c1 to c30, one project each, and every cluster present", () => {
		expect(CAST.map((m) => m.profile.id)).toEqual(
			Array.from({ length: 30 }, (_, i) => `c${i + 1}`),
		);
		expect(CAST.every((m) => m.profile.projectIdeas.length === 1)).toBe(
			true,
		);
		expect(new Set(CAST.map((m) => m.cluster))).toEqual(new Set(CLUSTERS));
	});

	test("everyone needs at least one role from others, never one they have, and each card explains it", () => {
		for (const { profile, needs, card } of CAST) {
			const own = profile.skills.map((s) => s.name);
			expect(needs.length).toBeGreaterThan(0);
			for (const role of needs) {
				expect(own).not.toContain(role);
				expect(card.roleWork[role]).toBeTruthy();
			}
		}
	});

	test("the first 14 mix every cluster", () => {
		const clusters = new Set(
			castProfiles(14).map(
				(p) => CAST.find((m) => m.profile.id === p.id)!.cluster,
			),
		);
		expect(clusters).toEqual(new Set(CLUSTERS));
	});

	test("expected groups don't overlap, and the agent-reliability fits come from the two agent groups", () => {
		const all = EXPECTED_GROUPS.flatMap((g) => g.members);
		expect(new Set(all).size).toBe(all.length);
		const agentGroups = EXPECTED_GROUPS.slice(0, 2).flatMap(
			(g) => g.members,
		);
		for (const id of EXPECTED_FOR_AGENT_RELIABILITY) {
			expect(agentGroups).toContain(id);
		}
	});
});

describe("judgeTeam", () => {
	test("a team within one expected group is predicted, counting only cast members", () => {
		expect(judgeTeam(["p-real", "c1", "c15"]).verdict).toBe("predicted");
	});

	test("a team in one cluster but no predicted group, and a team across clusters", () => {
		// The firewall and the belief receipts are both agent safety, in different groups.
		expect(judgeTeam(["c1", "c26"]).verdict).toBe("same cluster");
		expect(judgeTeam(["c1", "c3"])).toEqual({
			verdict: "across clusters",
			clusters: ["agent safety", "health"],
		});
	});
});
