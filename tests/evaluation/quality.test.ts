import { describe, expect, test } from "vitest";
import type { Profile } from "../../src/engine/profile.js";
import {
	availabilityOverlap,
	scoreTeam,
	sharedInterest,
	skillCoverage,
} from "../../src/evaluation/quality.js";
import { sampleProfile } from "../fixtures.js";

// A test profile with only the fields the quality score reads set explicitly.
function person(
	id: string,
	skills: Profile["skills"],
	interests: string[],
	utcOffset: number,
): Profile {
	return {
		...sampleProfile,
		id,
		skills,
		interests,
		availability: { hoursPerWeek: 20, utcOffset },
	};
}

// A skill list with a single frontend skill at the given level.
const frontend = (level: Profile["skills"][number]["level"]) => [
	{ name: "frontend", level },
];

// Identical people in the given time zones, to test availability alone.
function inZones(...offsets: number[]): Profile[] {
	return offsets.map((offset, i) =>
		person(`p${i}`, frontend("expert"), ["climate"], offset),
	);
}

// Identical people with the given interests, to test shared interest alone.
function withInterests(...lists: string[][]): Profile[] {
	return lists.map((interests, i) =>
		person(`p${i}`, frontend("expert"), interests, 0),
	);
}

describe("skillCoverage", () => {
	test("all core roles at expert is 1", () => {
		const team = [
			person("a", [{ name: "frontend", level: "expert" }], [], 0),
			person("b", [{ name: "backend", level: "expert" }], [], 0),
			person(
				"c",
				[
					{ name: "design", level: "expert" },
					{ name: "product", level: "expert" },
				],
				[],
				0,
			),
		];
		expect(skillCoverage(team)).toBe(1);
	});

	test("three frontend experts cover only one role", () => {
		const team = ["a", "b", "c"].map((id) =>
			person(id, frontend("expert"), [], 0),
		);
		expect(skillCoverage(team)).toBe(0.25);
	});

	test("a role counts at the best level anyone has", () => {
		const team = [
			person("a", frontend("beginner"), [], 0),
			person("b", frontend("expert"), [], 0),
		];
		expect(skillCoverage(team)).toBe(0.25);
	});

	test("non-core skills don't count", () => {
		const team = [person("a", [{ name: "ml", level: "expert" }], [], 0)];
		expect(skillCoverage(team)).toBe(0);
	});
});

describe("sharedInterest", () => {
	test("everyone sharing an interest is 1", () => {
		expect(
			sharedInterest(withInterests(["climate"], ["climate", "music"])),
		).toBe(1);
	});

	test("nobody sharing an interest is 0", () => {
		expect(
			sharedInterest(withInterests(["climate"], ["music"], ["food"])),
		).toBe(0);
	});

	test("3 of 4 sharing is in between", () => {
		const team = withInterests(
			["climate"],
			["climate"],
			["climate"],
			["music"],
		);
		expect(sharedInterest(team)).toBeCloseTo(2 / 3);
	});
});

describe("availabilityOverlap", () => {
	test("the same time zone is a full workday", () => {
		expect(availabilityOverlap(inZones(-5, -5))).toBe(1);
	});

	test("two hours apart shares six hours", () => {
		expect(availabilityOverlap(inZones(-5, -3))).toBe(0.75);
	});

	test("opposite sides of the world share nothing", () => {
		expect(availabilityOverlap(inZones(-5, 8))).toBe(0);
	});

	test("overlap across midnight counts", () => {
		// Los Angeles 16:00-17:00 is Tokyo 9:00-10:00 the next day.
		expect(availabilityOverlap(inZones(-8, 9))).toBe(1 / 8);
	});

	test("half-hour zones work", () => {
		expect(availabilityOverlap(inZones(0, 5.5))).toBe(2.5 / 8);
	});

	test("the whole team must be working at once", () => {
		expect(availabilityOverlap(inZones(0, 1, 2))).toBe(0.75);
	});
});

describe("scoreTeam", () => {
	const good = [
		person("a", [{ name: "frontend", level: "expert" }], ["climate"], -5),
		person("b", [{ name: "backend", level: "expert" }], ["climate"], -5),
		person(
			"c",
			[
				{ name: "design", level: "intermediate" },
				{ name: "product", level: "beginner" },
			],
			["climate", "education"],
			-3,
		),
	];
	const bad = [
		person("a", frontend("beginner"), ["gaming"], -5),
		person("b", frontend("beginner"), ["music"], 8),
		person("c", frontend("beginner"), ["food"], 0),
	];

	test("a complementary, aligned, nearby team scores high", () => {
		expect(scoreTeam(good)).toBeGreaterThan(0.8);
	});

	test("a redundant, unaligned, scattered team scores low", () => {
		expect(scoreTeam(bad)).toBeLessThan(0.2);
	});

	test("the score is the average of the three parts", () => {
		const parts =
			skillCoverage(good) +
			sharedInterest(good) +
			availabilityOverlap(good);
		expect(scoreTeam(good)).toBeCloseTo(parts / 3);
	});
});
