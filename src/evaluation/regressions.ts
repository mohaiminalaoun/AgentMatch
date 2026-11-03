// Fixed scenarios that replay each reasoning failure seen in the 2026-10-30 pilot, with made-up people (never
// real pilot data). Each case puts one agent at one moment, runs the engine's real prompt and schema for that
// moment, and asks a judge model one yes/no question: did the failure happen? Running every case several
// times gives a failure rate per case, so a fix can be shown to work on exactly the failure it targets.
import { z } from "zod";
import {
	createAgent,
	learn,
	raiseLevel,
	recordMessage,
	type AgentMessage,
	type AgentState,
} from "../engine/agent.js";
import type { LlmClient } from "../engine/client.js";
import {
	AgentCommitment,
	AgentOffers,
	commitmentMessages,
	offerMessages,
} from "../engine/commitment.js";
import { decideOnProposal, decisionPrompt } from "../engine/decision.js";
import { checkInterest, interestMessages } from "../engine/interest.js";
import type { Message } from "../engine/llm.js";
import { AgentConfidence, lockMessages } from "../engine/lock.js";
import { RepairVote, repairVoteMessages } from "../engine/repair.js";
import { getHunch, hunchMessages } from "../engine/hunch.js";
import type { Profile } from "../engine/profile.js";
import {
	JOIN_PREFIX,
	termsOf,
	type Offer,
	type Proposal,
} from "../engine/proposal.js";

// What one run of a case produced: the agent's prompt, its decision in a few words, and its rationale.
export type CaseRun = {
	prompt: Message[];
	decision: string;
	rationale: string | undefined;
};

export type RegressionCase = {
	name: string;
	// The failure, as seen in the pilot.
	failure: string;
	// What we'd accept instead.
	expected: string;
	run: (client: LlmClient) => Promise<CaseRun>;
	// Asked of the judge about the rationale; "yes" means the failure happened.
	question: string;
};

function person(
	id: string,
	name: string,
	overrides: Partial<Profile> = {},
): Profile {
	return {
		id,
		name,
		skills: [{ name: "frontend", level: "intermediate" }],
		interests: ["education"],
		projectIdeas: [],
		availability: { hoursPerWeek: 10, utcOffset: -5 },
		preferences: { minTeamSize: 2, maxTeamSize: 4, preferredRoles: [] },
		...overrides,
	};
}

// `agent` after a proposal it accepted from (or sent to) `other`, both having continued to `level`, with
// `learned` as what `other` shared.
function talking(
	agent: AgentState,
	other: string,
	proposal: Proposal,
	level: 1 | 2,
	learned: Partial<Profile>,
): AgentState {
	const messages: AgentMessage[] = [
		proposal,
		{
			decision: "accept",
			proposalId: proposal.id,
			from: proposal.to,
			to: proposal.from,
		},
		...(level === 2
			? ([agent.id, other] as const).map((from): AgentMessage => ({
					kind: "interest",
					from,
					to: from === agent.id ? other : agent.id,
					level: 1,
					interest: "continue",
				}))
			: []),
	];
	let state = messages.reduce((s, m) => recordMessage(s, other, m), agent);
	state = raiseLevel(state, other, level);
	return learn(state, other, learned);
}

// `agent`'s answer at the deadline about a tentative group of `members` building `title`/`pitch`, which still
// needs `needed`.
async function atDeadline(
	client: LlmClient,
	agent: AgentState,
	members: string[],
	title: string,
	pitch: string,
	needed: string[],
): Promise<CaseRun> {
	const prompt = lockMessages(
		agent,
		{
			id: `team-${members[0]}`,
			members,
			project: { title, description: pitch },
			rolesNeeded: needed,
			status: "tentative",
		},
		needed,
		1,
	);
	const { data } = await client.chatJson(prompt, AgentConfidence);
	return {
		prompt,
		decision: data.confident ? "stays (confident)" : "drops out",
		rationale: data.rationale,
	};
}

// Rafa's private hunch about a proposal from p-lena pitching `pitch`. One "never" note: he burned out on a
// payments startup.
async function hunchAbout(
	client: LlmClient,
	pitch: string,
	rolesNeeded: string[],
): Promise<CaseRun> {
	const rafa = createAgent(
		person("p-rafa", "Rafa", {
			skills: [
				{ name: "backend", level: "expert" },
				{ name: "frontend", level: "intermediate" },
			],
			interests: ["education", "finance"],
		}),
		[
			{
				text: "Burned out co-founding a payments startup; never again building anything that moves money.",
				level: "never",
			},
		],
	);
	const situation = `They propose: ${JSON.stringify({ pitch, rolesNeeded })}. Your agent will accept, counter, or decline.`;
	const hunch = (await getHunch(client, rafa, "p-lena", situation))!;
	return {
		prompt: hunchMessages(rafa, "p-lena", situation),
		decision: `steer ${hunch.steer}${hunch.evidence ? ` citing note ${hunch.evidence}` : ""}${hunch.unfounded ? " (cited no note, so made neutral)" : ""}`,
		rationale: hunch.rationale,
	};
}

// A decision on `proposal`: the prompt the engine sends, and what came back.
async function decide(
	client: LlmClient,
	agent: AgentState,
	proposal: Proposal,
): Promise<CaseRun> {
	const result = await decideOnProposal(client, agent, proposal);
	return {
		prompt: decisionPrompt(agent, proposal),
		decision: result.decision.decision,
		rationale: result.rationale,
	};
}

// An interest check with `other` at `level`.
async function interest(
	client: LlmClient,
	agent: AgentState,
	other: string,
	level: 1 | 2,
): Promise<CaseRun> {
	const result = await checkInterest(client, agent, other, level);
	return {
		prompt: interestMessages(agent, other, level),
		decision: `${result.interest}${result.revision ? ` with revision ${JSON.stringify(result.revision)}` : ""}`,
		rationale: result.rationale,
	};
}

const riya = person("p-riya", "Riya", {
	skills: [
		{ name: "backend", level: "expert" },
		{ name: "data", level: "expert" },
	],
	interests: ["health", "AI"],
	preferences: {
		minTeamSize: 2,
		maxTeamSize: 4,
		preferredRoles: ["backend"],
	},
});

// Synthetic project-search checkpoints. These test useful alternatives, preserving
// the motivating outcome, and avoiding unnecessary churn, rather than placement alone.
function projectSearch(
	client: LlmClient,
	kind: "pivot" | "preserve" | "keep",
): Promise<CaseRun> {
	const playful = kind === "pivot";
	const mine = person("search-a", "Avery", {
		skills: [
			{ name: "frontend", level: "expert" },
			{ name: "backend", level: "intermediate" },
		],
		interests: playful
			? ["games", "education"]
			: ["accessibility", "education"],
	});
	const other = person("search-b", "Blair", {
		skills: [
			{ name: "ml", level: "expert" },
			{ name: "data", level: "intermediate" },
		],
		interests: playful
			? ["sports coaching", "learning"]
			: ["accessibility", "education"],
		projectIdeas: [
			{
				title: playful ? "Match Report" : "Spoken Maths",
				description: playful
					? "Understand tactical choices from short annotated match clips."
					: "Help blind learners work through maths independently by voice.",
			},
		],
	});
	const proposal: Proposal = {
		id: "search-proposal",
		from: other.id,
		to: mine.id,
		title: playful ? "Match Report" : "Spoken Maths",
		pitch: playful
			? "A dashboard summarizing player positions and tactical mistakes from sample sports clips."
			: "Voice-first maths practice for blind learners with structured spoken feedback.",
		problem: playful
			? "New coaches struggle to explain tactical decisions to learners."
			: "Blind learners depend on sighted help with visual maths practice tools.",
		build: playful
			? "Upload one annotated clip and view positioning statistics and a report."
			: kind === "preserve"
				? "Voice problem input, spoken step-through and a shared session server with accounts."
				: "Five preset problems, voice input and structured spoken step-through, all with browser-local state.",
		rolesNeeded:
			kind === "preserve"
				? ["frontend", "backend", "devops"]
				: ["frontend", "backend"],
		roleWork: {
			frontend: playful
				? "report dashboard"
				: "accessible voice practice interface",
			backend:
				kind === "keep"
					? "browser-local exercise state"
					: "session input and output",
			...(kind === "preserve"
				? { devops: "host shared session server and account service" }
				: {}),
		},
	};
	const instructions = playful
		? "I want to build an interactive learning experience where users make choices and see consequences. A passive analytics dashboard is a weak fit. My existing flashcard idea is only a starting point."
		: "Preserve independent voice use for blind learners. A visual-only or static worksheet demo does not meet my goal. Prefer a focused working demo.";
	return interest(
		client,
		talking(createAgent(mine, [], instructions), other.id, proposal, 2, {
			interests: other.interests,
			projectIdeas: other.projectIdeas,
			skills: other.skills,
			availability: other.availability,
			preferences: other.preferences,
		}),
		other.id,
		2,
	);
}

export const PROJECT_SEARCH_CASES: readonly RegressionCase[] = [
	{
		name: "creative motivation pivot",
		failure:
			"Accepting a passive report despite an interactive-learning requirement, or abandoning a plausible collaboration without a useful alternative.",
		expected:
			"Proposes a concrete interactive learning direction grounded in coaching and learner choices, with real work for both people; no cosmetic points or unrelated flashcard replacement.",
		run: (client) => projectSearch(client, "pivot"),
		question:
			"Does the result fail to propose a concrete revision combining the stated coaching problem with consequential learner interaction, or invent a participant's skills or motivation? Merely adding badges, points or a quiz to an otherwise passive report is insufficient. A withdraw or continue without such a revision also counts as failure in this deliberately plausible pairing.",
	},
	{
		name: "creative preserve outcome",
		failure:
			"Simplifying away the independent voice interaction that motivates both people rather than changing the unnecessary infrastructure.",
		expected:
			"Proposes a buildable revision retaining voice input, spoken feedback and independent use while replacing uncovered hosting with a concrete local demo.",
		run: (client) => projectSearch(client, "preserve"),
		question:
			"Does the result fail to offer a revision that removes the uncovered hosting dependency while retaining independent voice input and spoken step-through for blind learners? Removing the motivating interaction, simply relabeling hosting, or offering no revision counts as failure.",
	},
	{
		name: "creative keep strong fit",
		failure:
			"Changing a project that already suits both people merely to demonstrate creativity.",
		expected:
			"Continues with the already focused voice practice project without a revision or invented evidence.",
		run: (client) => projectSearch(client, "keep"),
		question:
			"Does the agent withdraw, propose an unnecessary revision of this already aligned build, or assert invented participant skills, preferences or user validation?",
	},
];

async function scopeCardCase(
	client: LlmClient,
	kind: "uploads" | "adaptive" | "valid",
): Promise<CaseRun> {
	const profile = person("card-owner", "Avery", {
		skills: [{ name: "backend", level: "expert" }],
		interests: ["education"],
	});
	const teammate = person("card-peer", "Blair", {
		skills: [{ name: "ml", level: "expert" }],
		interests: ["education"],
	});
	const agent = learn(
		raiseLevel(createAgent(profile), teammate.id, 2),
		teammate.id,
		teammate,
	);
	const team = {
		id: "team-card-owner",
		members: [profile.id, teammate.id],
		project: {
			title: "Practice",
			description: "Voice practice with uploaded exercises.",
		},
		rolesNeeded: ["ml", "frontend"],
		status: "tentative" as const,
	};
	const revision = {
		title: "Practice Lite",
		problem: "Learners need practice with feedback.",
		pitch:
			kind === "uploads"
				? "Upload an exercise for voice practice."
				: kind === "adaptive"
					? "Live adaptive reporters follow up on each answer."
					: "Practice five bundled exercises with voice feedback.",
		build:
			kind === "adaptive"
				? "Fixed scripted reporter prompts with a scorecard."
				: "Five bundled exercises with voice feedback and local progress.",
		rolesNeeded: ["ml" as const],
		roleWork: { ml: "speech recognition and spoken exercise feedback" },
	};
	const prompt = repairVoteMessages(agent, team, {
		rationale: "PRIVATE NOT SHARED",
		revision,
		removedWork: [
			{
				role: "frontend",
				change:
					kind === "adaptive"
						? "Remove live adaptive follow-ups; use fixed scripted prompts."
						: "Remove upload screen and image upload; use bundled exercises only.",
			},
		],
	});
	const { data } = await client.chatJson(prompt, RepairVote);
	return {
		prompt,
		decision: `cardConsistent=${data.cardConsistent}; approve=${data.approve}`,
		rationale: data.rationale,
	};
}

export const SCOPE_CARD_CASES: readonly RegressionCase[] = (
	["uploads", "adaptive", "valid"] as const
).map((kind) => ({
	name: `scope card ${kind}`,
	failure:
		"Approving contradictory promises, or treating a consistently described smaller demo as contradictory.",
	expected:
		kind === "valid"
			? "Marks the honest bundled demo consistent."
			: "Marks the conflicting card inconsistent and rejects approval.",
	run: (client) => scopeCardCase(client, kind),
	question:
		kind === "valid"
			? "Does the decision mark cardConsistent=false even though every field consistently describes a bundled demo?"
			: "Does the decision mark cardConsistent=true or approve=true despite the explicit conflict between promised and removed functionality?",
}));

export const REGRESSION_CASES: readonly RegressionCase[] = [
	...PROJECT_SEARCH_CASES,
	...SCOPE_CARD_CASES,
	{
		name: "role omission",
		failure:
			'An agent reads roles a pitch doesn\'t list as free for its human ("roles needed are frontend/design/product, leaving backend/data for me").',
		expected:
			"It may accept to learn more, but doesn't claim the unlisted roles are open; the pitch's author may cover them.",
		run: (client) =>
			decide(client, createAgent(riya), {
				id: "r1-p-omar-p-riya",
				from: "p-omar",
				to: "p-riya",
				title: "Risk Explainer",
				pitch: "Early-risk prediction for chronic conditions with plain-language explanations for patients.",
				rolesNeeded: ["frontend", "design", "product"],
			}),
		question:
			"Does the rationale claim or assume that a role the pitch does not list (for example backend or data) is open or available for the agent's human to fill?",
	},
	{
		name: "join request",
		failure:
			"An owner judges a request to join its own project as if the requester offered the roles listed, which are the owner's own project's needs; nothing is known about the requester's skills yet.",
		expected:
			"It doesn't claim the requester has any skills or fills any role; their skills are unknown until level 2.",
		run: (client) =>
			decide(
				client,
				createAgent(
					person("p-riya", "Riya", {
						...riya,
						projectIdeas: [
							{
								title: "Ticket Triage",
								description:
									"AI that reads on-call tickets and suggests the likely root cause.",
							},
						],
					}),
				),
				{
					id: "r1-p-sam-p-riya",
					from: "p-sam",
					to: "p-riya",
					title: "Ticket Triage",
					pitch: `${JOIN_PREFIX}AI that reads on-call tickets and suggests the likely root cause.`,
					rolesNeeded: ["ml", "frontend", "devops"],
					join: true,
				},
			),
		question:
			"Does the rationale claim or assume that the agent who sent the request (p-sam) has skills in, or would fill, any of the listed roles (ml, frontend, devops)?",
	},
	{
		name: "invented scheduling",
		failure:
			'An agent turns time zones and weekly hours into scheduling certainty ("same time zone, so full overlap"; "7 hours apart, so almost no overlap").',
		expected:
			"It treats overlap as uncertain: time zones and hours are known, actual working times are not.",
		run: (client) => {
			const proposal: Proposal = {
				id: "r1-p-riya-p-lee",
				from: "p-riya",
				to: "p-lee",
				title: "Ticket Triage",
				pitch: "AI that reads on-call tickets and suggests the likely root cause.",
				rolesNeeded: ["frontend", "ml"],
			};
			const lee = person("p-lee", "Lee", {
				skills: [{ name: "ml", level: "intermediate" }],
				interests: ["AI", "developer tools"],
				availability: { hoursPerWeek: 12, utcOffset: -5 },
			});
			return interest(
				client,
				talking(createAgent(lee), "p-riya", proposal, 1, {
					interests: ["health", "AI"],
					availability: { hoursPerWeek: 10, utcOffset: -5 },
				}),
				"p-riya",
				1,
			);
		},
		question:
			"Does the rationale state as fact (not hedged with may/likely) how much the two humans' working hours overlap or when they can meet, beyond what their time zones and weekly hours alone establish?",
	},
	{
		name: "headcount",
		failure:
			"An agent treats each listed role as needing a separate person, so three roles means three more people.",
		expected:
			"It allows that one person may cover several roles, and doesn't reject or size a team by counting roles.",
		run: (client) =>
			decide(
				client,
				createAgent(
					person("p-gus", "Gus", {
						skills: [
							{ name: "ml", level: "intermediate" },
							{ name: "backend", level: "intermediate" },
						],
						interests: ["developer tools"],
						preferences: {
							minTeamSize: 2,
							maxTeamSize: 2,
							preferredRoles: ["ml"],
						},
					}),
				),
				{
					id: "r1-p-ivy-p-gus",
					from: "p-ivy",
					to: "p-gus",
					title: "Dev Tool Finder",
					pitch: "An app that helps developers discover and compare tools.",
					rolesNeeded: ["backend", "design", "product"],
				},
			),
		question:
			"Does the rationale assume that each listed role needs a separate person, for example that three listed roles means three more people or a team too big for the human's maximum size?",
	},
	{
		name: "misdescribed option",
		failure:
			'An agent choosing between offers describes one differently from its pitch ("no AI overlap" about an offer with "smart AI suggestions").',
		expected:
			"It may choose either, but describes each offer as its pitch does.",
		run: async (client) => {
			const mo = createAgent(
				person("p-mo", "Mo", {
					skills: [
						{ name: "frontend", level: "expert" },
						{ name: "ml", level: "intermediate" },
					],
					interests: ["AI", "developer tools"],
				}),
			);
			const offers: Offer[] = [
				{
					kind: "offer",
					from: "p-ana",
					to: "p-mo",
					team: "team-p-ana",
					title: "Ticket Triage",
					pitch: "AI that reads on-call tickets and diagnoses the likely root cause.",
					rolesNeeded: ["ml", "frontend"],
				},
				{
					kind: "offer",
					from: "p-ivo",
					to: "p-mo",
					team: "team-p-ivo",
					title: "Trip Board",
					pitch: "A live dashboard for travelers that tracks trips, costs, and plans with smart AI suggestions in one place.",
					rolesNeeded: ["frontend", "ml"],
				},
			];
			const shared = {
				interests: ["AI"],
				availability: { hoursPerWeek: 12, utcOffset: -5 },
				skills: [{ name: "backend", level: "expert" as const }],
				preferences: {
					minTeamSize: 2,
					maxTeamSize: 4,
					preferredRoles: ["backend"],
				},
			};
			const agent = offers.reduce(
				(a, offer) =>
					learn(raiseLevel(a, offer.from, 2), offer.from, shared),
				mo,
			);
			const prompt = commitmentMessages(agent, offers);
			const { data } = await client.chatJson(prompt, AgentCommitment);
			return {
				prompt,
				decision: data.commit
					? `commits to ${data.commit}`
					: "declines all",
				rationale: data.rationale,
			};
		},
		question:
			"Does the rationale describe either offered project differently from its pitch, for example saying one has no AI or ML component when its pitch mentions AI?",
	},
	{
		name: "unfinished team",
		failure:
			"An agent declines a good offer because the team is still smaller than its human's minimum size, or has roles nobody covers yet, as if the team were complete (checkpoint B, 2026-10-30).",
		expected:
			"It judges the team by what it can become: the owner can keep offering places. It may still decline for other reasons.",
		run: async (client) => {
			const lea = createAgent(
				person("p-lea", "Lea", {
					skills: [
						{ name: "frontend", level: "expert" },
						{ name: "design", level: "intermediate" },
					],
					interests: ["health", "education"],
					preferences: {
						minTeamSize: 3,
						maxTeamSize: 5,
						preferredRoles: ["frontend"],
					},
				}),
			);
			const offer: Offer = {
				kind: "offer",
				from: "p-sam",
				to: "p-lea",
				team: "team-p-sam",
				title: "Rehab Coach",
				pitch: "A web app that guides patients through physical therapy exercises at home, with progress tracking for their therapist.",
				rolesNeeded: ["frontend", "backend", "design"],
			};
			const agent = learn(raiseLevel(lea, "p-sam", 2), "p-sam", {
				interests: ["health", "fitness"],
				availability: { hoursPerWeek: 12, utcOffset: -4 },
				skills: [{ name: "product", level: "expert" }],
				preferences: {
					minTeamSize: 3,
					maxTeamSize: 5,
					preferredRoles: ["product"],
				},
			});
			const prompt = commitmentMessages(agent, [offer], [], {
				sizes: { "p-sam": 1 },
			});
			const { data } = await client.chatJson(prompt, AgentCommitment);
			return {
				prompt,
				decision: data.commit
					? `commits to ${data.commit}`
					: "declines all",
				rationale: data.rationale,
			};
		},
		question:
			"Does the agent decline, and does its rationale give as a reason that the team is currently smaller than the human's minimum size, or that a needed role isn't covered yet, without considering that the owner can still add people?",
	},
	{
		name: "pair coverage",
		failure:
			"At level 2, an agent whose human wrote the agreed version withdraws, or shrinks the project to drop them, because some of its roles have nobody in the pair who can do them, though the other person fills one, so an offer could follow and the team could find the rest later (2026-10-30 eval).",
		expected:
			"It doesn't count roles the pair can't cover against the project when the other person fills one; it may still withdraw or revise for other reasons.",
		run: (client) => {
			const proposal: Proposal = {
				id: "r1-p-lea-p-kai",
				from: "p-lea",
				to: "p-kai",
				title: "Finance Coach",
				pitch: "A budgeting app that explains spending patterns in plain language and suggests savings goals.",
				rolesNeeded: ["frontend", "backend", "ml"],
			};
			const lea = person("p-lea", "Lea", {
				skills: [
					{ name: "product", level: "expert" },
					{ name: "design", level: "intermediate" },
				],
				interests: ["finance", "education"],
				projectIdeas: [
					{
						title: "Finance Coach",
						description:
							"A budgeting app that explains spending patterns in plain language.",
					},
				],
				preferences: {
					minTeamSize: 3,
					maxTeamSize: 4,
					preferredRoles: ["product"],
				},
			});
			return interest(
				client,
				talking(createAgent(lea), "p-kai", proposal, 2, {
					interests: ["finance", "music"],
					availability: { hoursPerWeek: 12, utcOffset: -4 },
					skills: [
						{ name: "frontend", level: "expert" },
						{ name: "mobile", level: "intermediate" },
					],
					preferences: {
						minTeamSize: 2,
						maxTeamSize: 5,
						preferredRoles: ["frontend"],
					},
				}),
				"p-kai",
				2,
			);
		},
		question:
			"Does the agent either withdraw, or propose a revision that drops needed roles, giving as a reason that those roles (backend or ml) have nobody in the pair who can do them, even though the other person can do another needed role (frontend)?",
	},
	{
		name: "time zone gap",
		failure:
			'An agent waves away a 9-hour time-zone gap because the 9-to-5 overlap is "only an assumption" and meeting times are unknown, so the gap counts for nothing (2026-10-31 checkpoint).',
		expected:
			"It treats the gap as a fact with a real cost (one side's evening is the other's night) and weighs it; it may still continue.",
		run: (client) => {
			const proposal: Proposal = {
				id: "r1-p-kai-p-lea",
				from: "p-kai",
				to: "p-lea",
				title: "Study Buddy",
				pitch: "A study planner that pairs students for accountability sessions and tracks their progress.",
				rolesNeeded: ["frontend", "design"],
			};
			const lea = person("p-lea", "Lea", {
				skills: [
					{ name: "frontend", level: "expert" },
					{ name: "design", level: "intermediate" },
				],
				interests: ["education", "productivity"],
				availability: { hoursPerWeek: 10, utcOffset: -5 },
			});
			return interest(
				client,
				talking(createAgent(lea), "p-kai", proposal, 1, {
					interests: ["education", "productivity"],
					availability: { hoursPerWeek: 12, utcOffset: 4 },
				}),
				"p-kai",
				1,
			);
		},
		question:
			"Does the rationale dismiss or discount the 9-hour time-zone gap as not mattering, for example because the working-hours overlap is only an assumption or because actual meeting times are unknown, instead of counting it as a real cost?",
	},
	{
		name: "incomplete group",
		failure:
			"At the deadline, an agent drops out of a decent group only because it isn't complete: a role is still needed, or the team is smaller than ideal.",
		expected:
			"It weighs the gap as a cost and stays when the group is otherwise a good fit.",
		run: (client) => {
			const lea = createAgent(
				person("p-lea", "Lea", {
					skills: [
						{ name: "frontend", level: "expert" },
						{ name: "design", level: "intermediate" },
					],
					interests: ["health", "education"],
					preferences: {
						minTeamSize: 3,
						maxTeamSize: 4,
						preferredRoles: ["frontend"],
					},
				}),
			);
			const proposal: Proposal = {
				id: "r1-p-sam-p-lea",
				from: "p-sam",
				to: "p-lea",
				title: "Rehab Coach",
				pitch: "A web app that guides patients through physical therapy exercises at home.",
				rolesNeeded: ["frontend", "backend", "design"],
			};
			const agent = talking(lea, "p-sam", proposal, 2, {
				interests: ["health", "fitness"],
				availability: { hoursPerWeek: 12, utcOffset: -4 },
				skills: [{ name: "product", level: "expert" }],
				preferences: {
					minTeamSize: 3,
					maxTeamSize: 4,
					preferredRoles: ["product"],
				},
			});
			return atDeadline(
				client,
				agent,
				["p-sam", "p-lea", "p-kai"],
				"Rehab Coach",
				proposal.pitch,
				["backend"],
			);
		},
		question:
			"Does the agent drop out (not confident) giving as its main reason that the group is incomplete, such as a role still needed or the team being small, rather than a problem with the project, logistics, or use of its human's skills?",
	},
	{
		name: "bad group",
		failure:
			"At the deadline, an agent confirms a group that is clearly wrong for its human, its skills unused and a 10-hour time-zone gap, as if being in a group were enough.",
		expected:
			"It drops out, or at least weighs the unused skills and the gap; it may still stay if it gives a real reason.",
		run: (client) => {
			const lea = createAgent(
				person("p-lea", "Lea", {
					skills: [
						{ name: "design", level: "expert" },
						{ name: "data", level: "beginner" },
					],
					interests: ["education", "art"],
					availability: { hoursPerWeek: 8, utcOffset: -5 },
					preferences: {
						minTeamSize: 2,
						maxTeamSize: 4,
						preferredRoles: ["design"],
					},
				}),
			);
			const proposal: Proposal = {
				id: "r1-p-sam-p-lea",
				from: "p-sam",
				to: "p-lea",
				title: "Log Pipe",
				pitch: "A command-line service that collects server logs and ships them to cloud storage.",
				rolesNeeded: ["backend", "devops"],
			};
			const agent = talking(lea, "p-sam", proposal, 2, {
				interests: ["developer tools", "infrastructure"],
				availability: { hoursPerWeek: 20, utcOffset: 5 },
				skills: [{ name: "backend", level: "expert" }],
				preferences: {
					minTeamSize: 2,
					maxTeamSize: 3,
					preferredRoles: ["backend"],
				},
			});
			return atDeadline(
				client,
				agent,
				["p-sam", "p-lea"],
				"Log Pipe",
				proposal.pitch,
				["devops"],
			);
		},
		question:
			"Does the agent stay (confident) without weighing that its human's design and data skills go unused and that the time zones are 10 hours apart, for example staying just because it's already in the group?",
	},
	{
		name: "group time zones",
		failure:
			"An owner puts two people in one group who are each a few hours from it but far from each other, judging each only against its own human (2-seed run, 2026-10-31: trios averaged 0.125 overlap).",
		expected:
			"It weighs how the people it chooses fit each other, including the gap between them; it may still offer both if it says why.",
		run: async (client) => {
			const mia = createAgent(
				person("p-mia", "Mia", {
					skills: [{ name: "product", level: "expert" }],
					interests: ["education"],
					availability: { hoursPerWeek: 15, utcOffset: 0 },
					projectIdeas: [
						{
							title: "Study Buddy",
							description:
								"A study planner that pairs students for accountability sessions.",
						},
					],
					preferences: {
						minTeamSize: 3,
						maxTeamSize: 4,
						preferredRoles: ["product"],
					},
				}),
			);
			const proposal = (to: string): Proposal => ({
				id: `r1-p-mia-${to}`,
				from: "p-mia",
				to,
				title: "Study Buddy",
				pitch: "A study planner that pairs students for accountability sessions.",
				rolesNeeded: ["frontend", "backend"],
			});
			const shared = (skill: string, utcOffset: number) => ({
				interests: ["education"],
				availability: { hoursPerWeek: 12, utcOffset },
				skills: [{ name: skill, level: "expert" as const }],
				preferences: {
					minTeamSize: 3,
					maxTeamSize: 4,
					preferredRoles: [skill],
				},
			});
			const agent = talking(
				talking(
					mia,
					"p-ana",
					proposal("p-ana"),
					2,
					shared("frontend", -5),
				),
				"p-ben",
				proposal("p-ben"),
				2,
				shared("backend", 5),
			);
			const prompt = offerMessages(
				agent,
				["p-ana", "p-ben"],
				3,
				{},
				["frontend", "backend"],
				{
					agreed: {
						"p-ana": termsOf(proposal("p-ana")),
						"p-ben": termsOf(proposal("p-ben")),
					},
				},
			);
			const { data } = await client.chatJson(prompt, AgentOffers);
			return {
				prompt,
				decision: `offers ${data.offer.join(", ") || "nobody"}`,
				rationale: data.rationale,
			};
		},
		question:
			"Does the owner offer places to both p-ana and p-ben without its rationale weighing that p-ana and p-ben are 10 hours apart from each other (it may mention each one's gap to the owner, but not the gap between them)?",
	},
	{
		name: "hunch without evidence",
		failure:
			"A private hunch steers explore, careful, or stop on a note that doesn't bear on this person or project.",
		expected:
			"Neutral: the note about payments has nothing to do with a study planner.",
		run: (client) =>
			hunchAbout(
				client,
				"A study planner that pairs students for accountability sessions.",
				["frontend", "design"],
			),
		question:
			"Does the hunch steer explore, careful, or stop (not neutral), drawing on the note about payments or fintech, even though the project is a study planner with nothing to do with payments?",
	},
	{
		name: "hunch with evidence",
		failure:
			"A private hunch stays neutral on a project its human's note bears on directly, or steers without citing the note.",
		expected: "Careful or stop, citing the note about payments.",
		run: (client) =>
			hunchAbout(
				client,
				"A payments app that lets freelancers send invoices and get paid by card.",
				["backend", "frontend"],
			),
		question:
			"Does the hunch stay neutral, or steer without naming the note about burning out on payments, even though the project is a payments app?",
	},
	{
		name: "relabeled roles",
		failure:
			"An agent changes the project's roles just so an offer becomes possible (adding the other person's skill as a needed role), without saying what work that role does.",
		expected:
			"Any revision says what changes in the work and who does what; otherwise it withdraws or keeps the version.",
		run: (client) => {
			const proposal: Proposal = {
				id: "r1-p-kai-p-riya",
				from: "p-kai",
				to: "p-riya",
				title: "Risk Explainer",
				pitch: "Early-risk prediction for chronic conditions with plain-language explanations for patients.",
				rolesNeeded: ["frontend", "design", "product"],
			};
			const kai = person("p-kai", "Kai", {
				skills: [
					{ name: "ml", level: "expert" },
					{ name: "data", level: "intermediate" },
				],
				interests: ["health", "AI"],
				projectIdeas: [
					{
						title: "Risk Explainer",
						description:
							"Early-risk prediction for chronic conditions with plain-language explanations.",
					},
				],
			});
			return interest(
				client,
				talking(createAgent(kai), "p-riya", proposal, 2, {
					interests: riya.interests,
					availability: riya.availability,
					skills: riya.skills,
					preferences: riya.preferences,
				}),
				"p-riya",
				2,
			);
		},
		question:
			"Does the agent propose a revision whose main change is adding or swapping a needed role to match a skill the other person has, without describing what new work that role does in the project?",
	},
];

export const CaseVerdict = z.object({
	answer: z.enum(["yes", "no"]),
	// The rationale text the answer rests on, or why there's none.
	quote: z.string(),
});
export type CaseVerdict = z.infer<typeof CaseVerdict>;

// The prompt asking the judge `question` about one run: what the agent was told, what it decided, and why.
export function caseJudgeMessages(question: string, run: CaseRun): Message[] {
	return [
		{
			role: "system",
			content: [
				"You check one AI agent's private reasoning for a specific mistake. Below is everything the agent was told, what it decided, and its rationale.",
				`Answer this question about the rationale (and the decision, if it includes a revision): ${question}`,
				'Answer "yes" only if the rationale clearly does it; hedged wording ("may", "possibly", "unknown yet") does not count. Quote the words your answer rests on.',
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				"What the agent was told:",
				...run.prompt.map((m) => `[${m.role}]\n${m.content}`),
				"",
				`Its decision: ${run.decision}`,
				`Its rationale: ${run.rationale ?? "(none)"}`,
			].join("\n"),
		},
	];
}

export type CaseResult = {
	name: string;
	runs: number;
	failed: number;
	// Runs where the agent's call or the judge's failed, left out of the rate.
	errors: number;
	examples: { decision: string; quote: string }[];
};

// Runs `c` `times` at once and judges each; a failure is a "yes" from the judge.
export async function runCase(
	client: LlmClient,
	c: RegressionCase,
	times: number,
	onRun?: () => void,
): Promise<CaseResult> {
	const outcomes = await Promise.all(
		Array.from({ length: times }, async () => {
			try {
				const run = await c.run(client);
				const { data } = await client.chatJson(
					caseJudgeMessages(c.question, run),
					CaseVerdict,
				);
				return { run, verdict: data };
			} catch {
				return undefined;
			} finally {
				onRun?.();
			}
		}),
	);
	const done = outcomes.filter((o) => o !== undefined);
	const failures = done.filter((o) => o.verdict.answer === "yes");
	return {
		name: c.name,
		runs: done.length,
		failed: failures.length,
		errors: times - done.length,
		examples: failures.slice(0, 2).map((o) => ({
			decision: o.run.decision,
			quote: o.verdict.quote,
		})),
	};
}
