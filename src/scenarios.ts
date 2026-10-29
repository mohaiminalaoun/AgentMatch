// Hand-picked test cases for the live scripts (`decide`, `reliability`): a receiving agent's human
// and a proposal sent to them, chosen so accept, counter, and decline all come up.
import type { Note } from "./engine/notes.js";
import type { Profile } from "./engine/profile.js";
import type { Proposal } from "./engine/proposal.js";

export type Scenario = {
	name: string;
	receiver: Profile;
	proposal: Omit<Proposal, "id" | "to">;
};

// A backend engineer who wants to start a climate-change non-profit.
export const ben: Profile = {
	id: "ben",
	name: "Ben",
	skills: [
		{ name: "backend", level: "expert" },
		{ name: "data", level: "intermediate" },
	],
	interests: ["climate", "civic tech"],
	projectIdeas: [
		{
			title: "Climate-change non-profit",
			description:
				"A non-profit that helps cities measure and cut emissions.",
		},
	],
	availability: { hoursPerWeek: 20, utcOffset: -5 },
	preferences: {
		minTeamSize: 2,
		maxTeamSize: 4,
		preferredRoles: ["backend"],
	},
};

// A frontend developer who cares about accessibility and education.
export const kemi: Profile = {
	id: "kemi",
	name: "Kemi",
	skills: [
		{ name: "frontend", level: "expert" },
		{ name: "design", level: "intermediate" },
	],
	interests: ["accessibility", "education"],
	projectIdeas: [
		{
			title: "Accessible study tools",
			description: "Reading and note tools for students with dyslexia.",
		},
	],
	availability: { hoursPerWeek: 15, utcOffset: 1 },
	preferences: {
		minTeamSize: 2,
		maxTeamSize: 3,
		preferredRoles: ["frontend"],
	},
};

// An ML engineer interested in finance who only works on open-source projects.
export const omar: Profile = {
	id: "omar",
	name: "Omar",
	skills: [
		{ name: "ml", level: "expert" },
		{ name: "data", level: "expert" },
	],
	interests: ["finance", "open source"],
	projectIdeas: [
		{
			title: "Open-source risk dashboard",
			description:
				"An open-source dashboard that explains portfolio risk in plain language.",
		},
	],
	availability: { hoursPerWeek: 25, utcOffset: 5.5 },
	preferences: { minTeamSize: 3, maxTeamSize: 5, preferredRoles: ["ml"] },
};

// A product designer who loves music and multiplayer games.
export const rosa: Profile = {
	id: "rosa",
	name: "Rosa",
	skills: [
		{ name: "design", level: "expert" },
		{ name: "product", level: "intermediate" },
	],
	interests: ["music", "gaming"],
	projectIdeas: [
		{
			title: "Jam with friends",
			description:
				"An app where friends make music together in real time.",
		},
	],
	availability: { hoursPerWeek: 10, utcOffset: -8 },
	preferences: { minTeamSize: 3, maxTeamSize: 4, preferredRoles: ["design"] },
};

// An ML engineer whose project idea is an AI note-taking app; proposes to Kemi in `npm run negotiate`.
export const nia: Profile = {
	id: "nia",
	name: "Nia",
	skills: [
		{ name: "ml", level: "expert" },
		{ name: "backend", level: "intermediate" },
	],
	interests: ["education", "accessibility"],
	projectIdeas: [
		{
			title: "AI note-taking app",
			description: "An AI note-taking app for university students.",
		},
	],
	availability: { hoursPerWeek: 12, utcOffset: 0 },
	preferences: { minTeamSize: 2, maxTeamSize: 4, preferredRoles: ["ml"] },
};

// A frontend developer whose project idea is the invoicing startup; proposes in `npm run round`.
export const ivan: Profile = {
	id: "ivan",
	name: "Ivan",
	skills: [{ name: "frontend", level: "expert" }],
	interests: ["finance", "developer tools"],
	projectIdeas: [
		{
			title: "Invoicing for freelancers",
			description:
				"A web app startup that helps freelancers send invoices.",
		},
	],
	availability: { hoursPerWeek: 30, utcOffset: 0 },
	preferences: {
		minTeamSize: 2,
		maxTeamSize: 3,
		preferredRoles: ["frontend"],
	},
};

// The pair for `npm run coevolve`: a fitness-app builder, and someone into rehab and health data with an idea
// of their own nearby. Their ideas overlap enough to talk, and differ enough that a combined one is better.
export const theo: Profile = {
	id: "theo",
	name: "Theo",
	skills: [
		{ name: "frontend", level: "expert" },
		{ name: "design", level: "intermediate" },
	],
	interests: ["fitness", "running", "habits"],
	projectIdeas: [
		{
			title: "Workout tracker",
			description: "A fitness app that tracks workouts and streaks.",
		},
	],
	availability: { hoursPerWeek: 20, utcOffset: -5 },
	preferences: {
		minTeamSize: 2,
		maxTeamSize: 4,
		preferredRoles: ["frontend"],
	},
};

export const mara: Profile = {
	id: "mara",
	name: "Mara",
	skills: [
		{ name: "ml", level: "expert" },
		{ name: "backend", level: "intermediate" },
	],
	interests: ["injury recovery", "physical therapy", "health data"],
	projectIdeas: [
		{
			title: "Rehab coach",
			description:
				"An app that guides people through physical therapy exercises at home.",
		},
	],
	availability: { hoursPerWeek: 15, utcOffset: -4 },
	preferences: { minTeamSize: 2, maxTeamSize: 3, preferredRoles: ["ml"] },
};

// Theo's and Mara's private notes for `npm run coevolve`: what each told their own agent beyond the form.
// The "never" notes stay out of every prompt (step 11.2 will let them steer through text-free messages).
export const coevolveNotes: Record<string, Note[]> = {
	theo: [
		{
			text: "My running app side project died because people stopped logging after two weeks; streaks alone didn't keep them.",
			level: 1,
		},
		{
			text: "Likes shipping a rough version on day one and polishing later.",
			level: 2,
		},
		{
			text: "Burned out on a fitness startup last year; wary of anything that needs a big launch.",
			level: "never",
		},
	],
	mara: [
		{
			text: "Worked two years as a physio assistant before switching to ML; patients skipped their home exercises because they weren't sure they were doing them right.",
			level: 1,
		},
		{
			text: "Has a half-finished pose-estimation prototype she'd love to reuse.",
			level: 2,
		},
	],
};

export const SCENARIOS: Scenario[] = [
	{
		name: "invoicing vs climate",
		receiver: ben,
		proposal: {
			from: "agent-a",
			pitch: "A web app startup that helps freelancers send invoices.",
			rolesNeeded: ["frontend", "backend"],
		},
	},
	{
		name: "carbon tracker",
		receiver: ben,
		proposal: {
			from: "agent-a",
			pitch: "An open-source app that estimates a household's carbon footprint from receipts.",
			rolesNeeded: ["backend", "design"],
		},
	},
	{
		name: "student notes",
		receiver: kemi,
		proposal: {
			from: "agent-a",
			pitch: "An AI note-taking app for university students.",
			rolesNeeded: ["frontend", "ml"],
		},
	},
	{
		name: "crypto bot",
		receiver: omar,
		proposal: {
			from: "agent-a",
			pitch: "A closed-source crypto trading bot that predicts prices.",
			rolesNeeded: ["ml", "backend"],
		},
	},
	{
		name: "music game",
		receiver: rosa,
		proposal: {
			from: "agent-a",
			pitch: "A multiplayer rhythm game where friends make music together.",
			rolesNeeded: ["design", "frontend"],
		},
	},
];

// The scenario's proposal with an id and addressed to its receiver.
export function proposalFor(scenario: Scenario, id: string): Proposal {
	return { ...scenario.proposal, id, to: scenario.receiver.id };
}
