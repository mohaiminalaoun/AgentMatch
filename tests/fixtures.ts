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
