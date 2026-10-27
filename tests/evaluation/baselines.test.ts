import { describe, expect, test } from "vitest";
import type { Profile } from "../../src/engine/profile.js";
import { createRng } from "../../src/engine/random.js";
import { randomMatching } from "../../src/evaluation/baselines.js";
import { generateProfiles } from "../../src/evaluation/profiles.js";

const profiles = generateProfiles(40, 42);

// Member ids per team, for comparing groupings without the full profiles.
function ids(teams: Profile[][]): string[][] {
	return teams.map((team) => team.map((p) => p.id));
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
