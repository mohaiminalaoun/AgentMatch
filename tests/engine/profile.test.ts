import { expect, test } from "vitest";
import { sampleProfile as validProfile } from "../fixtures.js";
import { Profile } from "../../src/engine/profile.js";

test("a valid profile parses", () => {
	const result = Profile.safeParse(validProfile);
	expect(result.success).toBe(true);
});

test("a profile with no skills fails", () => {
	const result = Profile.safeParse({ ...validProfile, skills: [] });
	expect(result.success).toBe(false);
});

test("an unknown skill level fails", () => {
	const result = Profile.safeParse({
		...validProfile,
		skills: [{ name: "rust", level: "wizard" }],
	});
	expect(result.success).toBe(false);
});

test("min team size above max fails", () => {
	const result = Profile.safeParse({
		...validProfile,
		preferences: { ...validProfile.preferences, minTeamSize: 5 },
	});
	expect(result.success).toBe(false);
});
