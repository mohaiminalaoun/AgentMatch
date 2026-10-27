import { describe, expect, test } from "vitest";
import type { Profile } from "../../src/engine/profile.js";
import { createRng } from "../../src/engine/random.js";
import {
	greedyMatching,
	localSearchMatching,
	randomMatching,
} from "../../src/evaluation/baselines.js";
import { generateProfiles } from "../../src/evaluation/profiles.js";
import { scoreTeam } from "../../src/evaluation/quality.js";
import { person } from "../fixtures.js";

const profiles = generateProfiles(40, 42);

// Member ids per team, for comparing groupings without the full profiles.
function ids(teams: Profile[][]): string[][] {
	return teams.map((team) => team.map((p) => p.id));
}

// The mean score across all teams in a grouping.
function averageScore(teams: Profile[][]): number {
	return teams.reduce((sum, team) => sum + scoreTeam(team), 0) / teams.length;
}

describe("randomMatching", () => {
	test("everyone is placed in exactly one team", () => {
		const placed = ids(randomMatching(profiles, createRng(1))).flat();
		expect(placed.sort()).toEqual(profiles.map((p) => p.id).sort());
	});

	test("40 people make 13 teams of 3 or 4", () => {
		const teams = randomMatching(profiles, createRng(1));
		expect(teams).toHaveLength(13);
		expect(teams.every((t) => t.length === 3 || t.length === 4)).toBe(true);
	});

	test("an exact multiple makes equal teams", () => {
		const teams = randomMatching(profiles.slice(0, 12), createRng(1), 4);
		expect(teams.map((t) => t.length)).toEqual([4, 4, 4]);
	});

	test("the same seed gives the same teams", () => {
		expect(ids(randomMatching(profiles, createRng(1)))).toEqual(
			ids(randomMatching(profiles, createRng(1))),
		);
	});

	test("different seeds give different teams", () => {
		expect(ids(randomMatching(profiles, createRng(1)))).not.toEqual(
			ids(randomMatching(profiles, createRng(2))),
		);
	});

	test("the input list is not changed", () => {
		const before = profiles.map((p) => p.id);
		randomMatching(profiles, createRng(1));
		expect(profiles.map((p) => p.id)).toEqual(before);
	});

	test("too few people for one team throws", () => {
		expect(() =>
			randomMatching(profiles.slice(0, 2), createRng(1)),
		).toThrow();
	});

	test("a team size below 2 throws", () => {
		expect(() => randomMatching(profiles, createRng(1), 1)).toThrow();
	});
});

describe("greedyMatching", () => {
	test("everyone is placed in exactly one team", () => {
		const placed = ids(greedyMatching(profiles)).flat();
		expect(placed.sort()).toEqual(profiles.map((p) => p.id).sort());
	});

	test("40 people make 13 teams of 3 or 4, like random matching", () => {
		const teams = greedyMatching(profiles);
		expect(teams).toHaveLength(13);
		expect(teams.every((t) => t.length === 3 || t.length === 4)).toBe(true);
	});

	test("leftovers spread like random dealing when teams are few", () => {
		const sizes = (teams: Profile[][]) => teams.map((t) => t.length).sort();
		const five = profiles.slice(0, 5);
		expect(sizes(greedyMatching(five))).toEqual(
			sizes(randomMatching(five, createRng(1))),
		);
	});

	test("the same input always gives the same teams", () => {
		expect(ids(greedyMatching(profiles))).toEqual(
			ids(greedyMatching(profiles)),
		);
	});

	test("finds two obvious teams even when the list is interleaved", () => {
		const role = (name: string) => [{ name, level: "expert" as const }];
		const people = [
			person("climate-fe", role("frontend"), ["climate"], -5),
			person("music-fe", role("frontend"), ["music"], 8),
			person("climate-be", role("backend"), ["climate"], -5),
			person("music-be", role("backend"), ["music"], 8),
			person("climate-de", role("design"), ["climate"], -5),
			person("music-de", role("design"), ["music"], 8),
		];
		const teams = ids(greedyMatching(people)).map((t) => t.sort());
		expect(teams).toEqual([
			["climate-be", "climate-de", "climate-fe"],
			["music-be", "music-de", "music-fe"],
		]);
	});

	test("beats random matching on average", () => {
		const randomAverage =
			[1, 2, 3, 4, 5]
				.map((seed) =>
					averageScore(randomMatching(profiles, createRng(seed))),
				)
				.reduce((a, b) => a + b) / 5;
		expect(averageScore(greedyMatching(profiles))).toBeGreaterThan(
			randomAverage,
		);
	});
});

describe("localSearchMatching", () => {
	const teams = localSearchMatching(profiles);

	test("everyone is placed in exactly one team", () => {
		const placed = ids(teams).flat();
		expect(placed.sort()).toEqual(profiles.map((p) => p.id).sort());
	});

	test("keeps greedy's team sizes", () => {
		const sizes = (groups: Profile[][]) => groups.map((t) => t.length);
		expect(sizes(teams)).toEqual(sizes(greedyMatching(profiles)));
	});

	test("the same input always gives the same teams", () => {
		expect(ids(localSearchMatching(profiles))).toEqual(ids(teams));
	});

	test("is never worse than greedy, and better here", () => {
		for (const seed of [1, 2, 3]) {
			const people = generateProfiles(40, seed);
			expect(
				averageScore(localSearchMatching(people)),
			).toBeGreaterThanOrEqual(averageScore(greedyMatching(people)));
		}
		expect(averageScore(teams)).toBeGreaterThan(
			averageScore(greedyMatching(profiles)),
		);
	});

	test("stops at a local optimum: no single swap improves it", () => {
		for (let a = 0; a < teams.length; a++) {
			for (let b = a + 1; b < teams.length; b++) {
				const before = scoreTeam(teams[a]!) + scoreTeam(teams[b]!);
				for (let i = 0; i < teams[a]!.length; i++) {
					for (let j = 0; j < teams[b]!.length; j++) {
						const after =
							scoreTeam(teams[a]!.with(i, teams[b]![j]!)) +
							scoreTeam(teams[b]!.with(j, teams[a]![i]!));
						expect(after).toBeLessThanOrEqual(before + 1e-9);
					}
				}
			}
		}
	});
});
