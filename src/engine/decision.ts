import { z } from "zod";
import { aboutHuman } from "./notes.js";
import { contactOf, type AgentState } from "./agent.js";
import type { LlmClient } from "./client.js";
import {
	FIELD_LEVELS,
	type DisclosureLevel,
	type ProfileField,
} from "./disclosure.js";
import { checkDisclosure, draftOf, type Violation } from "./gate.js";
import {
	StructuredOutputError,
	type ChatJsonOptions,
	type Message,
	type TokenUsage,
} from "./llm.js";
import { factsText, fitFacts } from "./fit.js";
import { CITE_FACTS, GOOD_TEAM } from "./goals.js";
import { steerText, type Hunch } from "./hunch.js";
import {
	BRAINSTORM_PITCH,
	Decision,
	isJoinRequest,
	JOIN_PREFIX,
	type Proposal,
} from "./proposal.js";

// What the model returns: its private reasoning, then the decision that gets sent.
// The rationale comes first so the model reasons before it decides.
export const AgentDecision = z.object({
	rationale: z.string().min(1),
	decision: Decision,
});

export type AgentDecision = z.infer<typeof AgentDecision>;

export type DecisionResult = {
	// What to send back; always passed by the gate.
	decision: Decision;
	// Why, for the agent's own human and logs only; never sent. Missing if the model never gave a valid reply.
	rationale: string | undefined;
	// How many times the gate stopped something from going out.
	gateBlocks: number;
	// True when no allowed decision came back and a plain decline was sent instead.
	fellBack: boolean;
	usage: TokenUsage | undefined;
	// The private hunch that steered this decision, for agents with "never" notes.
	hunch?: Hunch | undefined;
};

// The most counters one conversation may have, from both sides together. After that, the next decision must
// accept or decline, so two agents can't counter each other forever.
export const MAX_COUNTERS = 2;

// How many counters have gone back and forth with `otherId`.
function countersWith(agent: AgentState, otherId: string): number {
	return contactOf(agent, otherId).history.filter(
		(m) => "decision" in m && m.decision === "counter",
	).length;
}

// How each profile field reads in the prompt's disclosure rules.
const FIELD_NAMES: Record<ProfileField, string> = {
	id: "your agent id",
	projectIdeas: "your human's project ideas",
	interests: "your human's interests",
	availability: "your human's availability or time zone",
	skills: "your human's skills or experience",
	preferences: "your human's preferred roles or team size",
	name: "your human's name",
};

// The disclosure rules for anything sent at `level`, from FIELD_LEVELS, the same table the gate enforces.
export function disclosureRules(level: DisclosureLevel): string {
	const fields = (Object.keys(FIELD_LEVELS) as ProfileField[]).filter(
		(field) => field !== "id",
	);
	const may = fields.filter((f) => FIELD_LEVELS[f] <= level);
	const mayNot = fields.filter((f) => FIELD_LEVELS[f] > level);
	const list = (items: ProfileField[]) =>
		items.map((f) => FIELD_NAMES[f]).join("; ") || "nothing";
	return [
		`Disclosure rules: you are at level ${level} with this agent.`,
		`In anything you send, you may mention: ${list(may)}.`,
		`Never mention: ${list(mayNot)}.`,
		"Your rationale is private and never sent, so explain yourself fully there.",
	].join("\n");
}

// The prompt asking `agent` to accept, counter, or decline `proposal`, built from its real profile and
// what it knows about the sender. The disclosure rules come from FIELD_LEVELS, the same table the gate enforces.
export function decisionMessages(
	agent: AgentState,
	proposal: Proposal,
	// A private hunch, which adds only a fixed sentence for its steer.
	hunch?: Hunch,
): Message[] {
	const steer = steerText(hunch, "decision");
	const contact = contactOf(agent, proposal.from);
	const countersLeft = countersWith(agent, proposal.from) < MAX_COUNTERS;

	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				aboutHuman(agent, contact.level),
				GOOD_TEAM,
				factsText(fitFacts(agent, proposal.from)),
				disclosureRules(contact.level),
				[
					"How to decide:",
					"- accept if a good team could plausibly come of it: your human could fill a role the project lists, and it's something they'd want to build. Nothing is binding yet; accepting opens the next level of sharing.",
					'- counter if it is a partial fit and one concrete change would make it work: put the changed project in the pitch, describing the project itself, not a message to them (no questions, no "how about"), and give it a short new title, 1 to 4 words, if the change makes the old one wrong.',
					"- rolesNeeded lists roles you need others to fill. Never list a role your human would fill.",
					"- decline otherwise. Declines carry no message: if a change could make it work, counter instead.",
					CITE_FACTS,
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`Agent ${proposal.from} proposes:`,
				`Pitch: ${proposal.pitch}`,
				`Roles needed: ${proposal.rolesNeeded.join(", ")}`,
				...(proposal.leftTeams
					? [
							`Reliability: their human has left ${proposal.leftTeams} committed team${proposal.leftTeams === 1 ? "" : "s"} before, so they may leave again.`,
						]
					: []),
				`What you have learned about them so far: ${JSON.stringify(contact.learned)}`,
				`Earlier messages between you: ${contact.history.length === 0 ? "none" : JSON.stringify(contact.history)}`,
				...(countersLeft
					? []
					: [
							`You have already exchanged ${MAX_COUNTERS} counters, the most allowed: this time, accept or decline. A counter won't be sent.`,
						]),
				...(proposal.pitch === BRAINSTORM_PITCH
					? [
							"This is an invitation to come up with a project together; nothing is decided yet. Accept if your humans could plausibly complement each other. A counter can put a first idea on the table.",
						]
					: []),
				...(steer ? [steer] : []),
			].join("\n"),
		},
	];
}

// The prompt asking `agent`, whose human owns a project, whether to accept or decline a request to join it from
// someone with no project of their own. The request's terms are the owner's own listing, so its roles are what
// the owner's project needs, not what the requester offers; nothing about the requester is known until they
// share, which only happens if the owner accepts.
export function joinRequestMessages(
	agent: AgentState,
	proposal: Proposal,
	// A private hunch, which adds only a fixed sentence for its steer.
	hunch?: Hunch,
): Message[] {
	const steer = steerText(hunch, "interest");
	const contact = contactOf(agent, proposal.from);
	const pitch = proposal.pitch.startsWith(JOIN_PREFIX)
		? proposal.pitch.slice(JOIN_PREFIX.length)
		: proposal.pitch;
	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				aboutHuman(agent, contact.level),
				GOOD_TEAM,
				factsText(fitFacts(agent, proposal.from)),
				[
					`Agent ${proposal.from} has no project of its own and asks to join your human's project. The pitch and roles below are your human's own listing: the roles are what your human's project needs from others, not what ${proposal.from} offers.`,
					`Nothing is known about ${proposal.from}'s human yet. If you accept, you each share interests and availability (level 1), then skills and preferences (level 2), and either side can stop after each. Don't assume they have any skill or would fill any role; that's what the next levels find out.`,
					"How to decide:",
					"- accept to find out whether they fit your human's project.",
					"- decline only if your human's project can't take anyone now, or your human has reasons not to work with someone new on it.",
					"- Counters aren't possible here: if the project should change to fit them, propose a revision once you know them.",
					"Your rationale is private; accept and decline carry no text.",
					CITE_FACTS,
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`Agent ${proposal.from} asks to join your human's project:`,
				`Your human's pitch: ${pitch}`,
				`Roles your human's project needs: ${proposal.rolesNeeded.join(", ")}`,
				...(proposal.leftTeams
					? [
							`Reliability: their human has left ${proposal.leftTeams} committed team${proposal.leftTeams === 1 ? "" : "s"} before, so they may leave again.`,
						]
					: []),
				`What you have learned about them so far: ${JSON.stringify(contact.learned)}`,
				...(steer ? [steer] : []),
			].join("\n"),
		},
	];
}

// The prompt for deciding on `proposal`: a join request gets its own, anything else the general one.
export function decisionPrompt(
	agent: AgentState,
	proposal: Proposal,
	hunch?: Hunch,
): Message[] {
	return isJoinRequest(proposal)
		? joinRequestMessages(agent, proposal, hunch)
		: decisionMessages(agent, proposal, hunch);
}

// Decides on `proposal` for `agent`, with every outgoing word passed through the disclosure gate. Once a
// conversation has had MAX_COUNTERS counters, another counter is refused and the model asked again.
// A counter that reveals too much is redrafted; if nothing allowed comes back, a plain decline is sent.
// Declines can't leak by construction: they have no text. Updating the agent's state is left to the caller.
export async function decideOnProposal(
	client: LlmClient,
	agent: AgentState,
	proposal: Proposal,
	options: ChatJsonOptions<AgentDecision> = {},
	// A private hunch from the agent's "never" notes: "stop" declines with no call, and "careful" rules out a
	// plain accept.
	hunch?: Hunch,
): Promise<DecisionResult> {
	const level = contactOf(agent, proposal.from).level;
	const countersLeft = countersWith(agent, proposal.from) < MAX_COUNTERS;
	const join = isJoinRequest(proposal);
	let gateBlocks = 0;
	if (hunch?.steer === "stop") {
		return {
			decision: { decision: "decline" },
			rationale: undefined,
			gateBlocks,
			fellBack: false,
			usage: undefined,
			hunch,
		};
	}

	try {
		const { data, usage } = await client.chatJson(
			decisionPrompt(agent, proposal, hunch),
			AgentDecision,
			{
				...options,
				check: ({ decision }) => {
					if (join && decision.decision === "counter") {
						return [
							"a request to join your human's project is accepted or declined; once you know them, you can propose a revision",
						];
					}
					// Accepting a join request is itself the way to probe, so caution doesn't rule it out.
					if (
						decision.decision === "accept" &&
						hunch?.steer === "careful" &&
						!join
					) {
						return [
							"your human has private reasons for caution: don't accept as is; counter with a question or change that addresses it, or decline",
						];
					}
					if (decision.decision === "counter" && !countersLeft) {
						return [
							`no counters are left in this conversation (${MAX_COUNTERS} already exchanged); accept or decline`,
						];
					}
					const violations = checkDisclosure(
						agent.profile,
						level,
						draftOf(decision),
					);
					if (violations.length > 0) {
						gateBlocks++;
					}
					return violations.map((v) => describeViolation(v, level));
				},
			},
		);
		return {
			decision: data.decision,
			rationale: data.rationale,
			gateBlocks,
			fellBack: false,
			usage,
			hunch,
		};
	} catch (error) {
		if (!(error instanceof StructuredOutputError)) {
			throw error;
		}
		return {
			decision: { decision: "decline" },
			rationale: undefined,
			gateBlocks,
			fellBack: true,
			usage: undefined,
			hunch,
		};
	}
}

// Feedback for the agent's own model about what it may not say yet. It quotes the human's own data back
// to their own agent, which is fine: feedback never reaches the other side.
export function describeViolation(
	violation: Violation,
	level: DisclosureLevel,
): string {
	const where =
		violation.where === "roles" ? "roles needed list" : violation.where;
	return `your ${where} mentions ${FIELD_NAMES[violation.field as ProfileField] ?? violation.field} ("${violation.match}"), which you may not share at level ${level}; rewrite it without that`;
}
