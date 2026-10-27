import { z } from "zod";
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
import { Decision, type Proposal } from "./proposal.js";

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
};

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

// The prompt asking `agent` to accept, counter, or decline `proposal`, built from its real profile and
// what it knows about the sender. The disclosure rules come from FIELD_LEVELS, the same table the gate enforces.
export function decisionMessages(
	agent: AgentState,
	proposal: Proposal,
): Message[] {
	const contact = contactOf(agent, proposal.from);
	const fields = (Object.keys(FIELD_LEVELS) as ProfileField[]).filter(
		(field) => field !== "id",
	);
	const may = fields.filter((f) => FIELD_LEVELS[f] <= contact.level);
	const mayNot = fields.filter((f) => FIELD_LEVELS[f] > contact.level);
	const list = (items: ProfileField[]) =>
		items.map((f) => FIELD_NAMES[f]).join("; ") || "nothing";

	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				`Your human's full profile (private; for your judgment only):\n${JSON.stringify(agent.profile, null, 2)}`,
				[
					`Disclosure rules: you are at level ${contact.level} with this agent.`,
					`In anything you send, you may mention: ${list(may)}.`,
					`Never mention: ${list(mayNot)}.`,
					"Your rationale is private and never sent, so explain yourself fully there.",
				].join("\n"),
				[
					"How to decide:",
					"- accept only if the project clearly fits your human's project ideas or interests AND they could fill a role it needs.",
					"- counter if it is a partial fit and one concrete change would make it work; put the changed project in the pitch.",
					"- decline otherwise. Declines carry no message: if a change could make it work, counter instead.",
					"Be selective: your human has limited time, and accepting a weak fit blocks a better one.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`Agent ${proposal.from} proposes:`,
				`Pitch: ${proposal.pitch}`,
				`Roles needed: ${proposal.rolesNeeded.join(", ")}`,
				`What you have learned about them so far: ${JSON.stringify(contact.learned)}`,
				`Earlier messages between you: ${contact.history.length === 0 ? "none" : JSON.stringify(contact.history)}`,
			].join("\n"),
		},
	];
}

// Decides on `proposal` for `agent`, with every outgoing word passed through the disclosure gate.
// A counter that reveals too much is redrafted; if nothing allowed comes back, a plain decline is sent.
// Declines can't leak by construction: they have no text. Updating the agent's state is left to the caller.
export async function decideOnProposal(
	client: LlmClient,
	agent: AgentState,
	proposal: Proposal,
	options: ChatJsonOptions<AgentDecision> = {},
): Promise<DecisionResult> {
	const level = contactOf(agent, proposal.from).level;
	let gateBlocks = 0;

	try {
		const { data, usage } = await client.chatJson(
			decisionMessages(agent, proposal),
			AgentDecision,
			{
				...options,
				check: ({ decision }) => {
					const violations = checkDisclosure(
						agent.profile,
						level,
						draftOf(decision),
					);
					if (violations.length > 0) {
						gateBlocks++;
					}
					return violations.map((v) => describe(v, level));
				},
			},
		);
		return {
			decision: data.decision,
			rationale: data.rationale,
			gateBlocks,
			fellBack: false,
			usage,
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
		};
	}
}

// Feedback for the agent's own model about what it may not say yet. It quotes the human's own data back
// to their own agent, which is fine: feedback never reaches the other side.
function describe(violation: Violation, level: DisclosureLevel): string {
	return `your ${violation.where} mentions ${FIELD_NAMES[violation.field as ProfileField] ?? violation.field} ("${violation.match}"), which you may not share at level ${level}; rewrite it without that`;
}
