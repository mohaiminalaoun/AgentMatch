import type { Profile } from "../src/engine/profile.js";

export const sampleProfile: Profile = {
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

// A test profile with only the fields the matching and quality code reads set explicitly.
export function person(
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
