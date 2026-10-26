import { expect, test } from "vitest";
import { Profile } from "./profile.js";

const validProfile = {
	id: "p1",
	name: "Ada",
	skills: [
		{ name: "typescript", level: "expert" },
		{ name: "design", level: "beginner" },
	],
	interests: ["climate", "education"],
	projectIdeas: [
		{
			title: "Carbon tracker",
			description: "Estimate a household's footprint from receipts.",
		},
	],
	availability: { hoursPerWeek: 20, utcOffset: -5 },
	preferences: {
		minTeamSize: 2,
		maxTeamSize: 4,
		preferredRoles: ["backend"],
	},
};

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
