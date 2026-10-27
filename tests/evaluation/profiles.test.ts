import { expect, test } from "vitest";
import { Profile } from "../../src/engine/profile.js";
import { generateProfiles } from "../../src/evaluation/profiles.js";

test("generates the requested number of valid profiles", () => {
	const profiles = generateProfiles(40, 42);
	expect(profiles).toHaveLength(40);
	for (const profile of profiles) {
		expect(Profile.safeParse(profile).success).toBe(true);
	}
});

test("the same seed gives the same profiles", () => {
	expect(generateProfiles(40, 42)).toEqual(generateProfiles(40, 42));
});

test("different seeds give different profiles", () => {
	expect(generateProfiles(40, 1)).not.toEqual(generateProfiles(40, 2));
});

test("ids are unique", () => {
	const ids = generateProfiles(40, 42).map((p) => p.id);
	expect(new Set(ids).size).toBe(40);
});

test("profiles are varied", () => {
	const profiles = generateProfiles(40, 42);
	const skills = new Set(
		profiles.flatMap((p) => p.skills.map((s) => s.name)),
	);
	const interests = new Set(profiles.flatMap((p) => p.interests));
	const offsets = new Set(profiles.map((p) => p.availability.utcOffset));
	expect(skills.size).toBeGreaterThanOrEqual(6);
	expect(interests.size).toBeGreaterThanOrEqual(8);
	expect(offsets.size).toBeGreaterThanOrEqual(5);
});

test("preferred roles are among the person's skills", () => {
	for (const profile of generateProfiles(40, 42)) {
		const skillNames = profile.skills.map((s) => s.name);
		for (const role of profile.preferences.preferredRoles) {
			expect(skillNames).toContain(role);
		}
	}
});

test("zero profiles gives an empty list", () => {
	expect(generateProfiles(0, 42)).toEqual([]);
});
