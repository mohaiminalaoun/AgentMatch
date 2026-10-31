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
import { AgentCommitment, commitmentMessages } from "../engine/commitment.js";
import { decideOnProposal, decisionPrompt } from "../engine/decision.js";
import { checkInterest, interestMessages } from "../engine/interest.js";
import type { Message } from "../engine/llm.js";
import type { Profile } from "../engine/profile.js";
import { JOIN_PREFIX, type Offer, type Proposal } from "../engine/proposal.js";

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

export const REGRESSION_CASES: readonly RegressionCase[] = [
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
