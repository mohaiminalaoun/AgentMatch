import { z } from "zod";
import { contactOf, type AgentState } from "./agent.js";
import type { LlmClient } from "./client.js";
import {
	StructuredOutputError,
	type ChatJsonOptions,
	type Message,
	type TokenUsage,
} from "./llm.js";

// What the model returns after learning a share: private reasoning, then a yes or no.
export const AgentInterest = z.object({
	rationale: z.string().min(1),
	interest: z.enum(["continue", "withdraw"]),
});

export type AgentInterest = z.infer<typeof AgentInterest>;

export type InterestResult = {
	interest: AgentInterest["interest"];
	// Why, for the agent's own human and logs only; never sent. Missing if no valid reply came back.
	rationale: string | undefined;
	// True when no valid reply came back and the agent withdrew to be safe.
	fellBack: boolean;
	usage: TokenUsage | undefined;
};

// What to weigh at each level, given what has just been shared.
const WEIGHING: Record<number, string> = {
	1: "Their interests and availability are now known. Do their interests line up with your human's? Can they actually work together: are the time zones close enough to overlap, and does each have enough hours?",
	2: "Their skills and preferences are now known. Do their skills complement your human's, covering roles your human can't? Do their preferred roles and team size fit?",
	3: "Their name is now known. Is there any reason not to form a team?",
};

// The prompt asking `agent` whether to keep going with `otherId`, built from its own profile and only
// what the other side has shared with it so far.
export function interestMessages(
	agent: AgentState,
	otherId: string,
): Message[] {
	const contact = contactOf(agent, otherId);
	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				`Your human's full profile (private; for your judgment only):\n${JSON.stringify(agent.profile, null, 2)}`,
				[
					`You and agent ${otherId} both agreed to keep talking and are now at level ${contact.level}.`,
					WEIGHING[contact.level] ?? "",
					"Decide whether to keep going toward a team (continue) or stop here (withdraw).",
					"Be selective: your human has limited time, and a weak match blocks a better one.",
					"Only the single word continue or withdraw is sent; your rationale is private, so explain yourself fully there.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`What agent ${otherId} has shared with you so far: ${JSON.stringify(contact.learned)}`,
				`Messages between you so far: ${JSON.stringify(contact.history)}`,
				"Keep going, or withdraw?",
			].join("\n"),
		},
	];
}

// Asks `agent`'s model whether to keep going with `otherId`. If no valid answer comes back, withdraws:
// stopping is the safe default, since continuing would share more.
export async function checkInterest(
	client: LlmClient,
	agent: AgentState,
	otherId: string,
	options: ChatJsonOptions<AgentInterest> = {},
): Promise<InterestResult> {
	try {
		const { data, usage } = await client.chatJson(
			interestMessages(agent, otherId),
			AgentInterest,
			options,
		);
		return {
			interest: data.interest,
			rationale: data.rationale,
			fellBack: false,
			usage,
		};
	} catch (error) {
		if (!(error instanceof StructuredOutputError)) {
			throw error;
		}
		return {
			interest: "withdraw",
			rationale: undefined,
			fellBack: true,
			usage: undefined,
		};
	}
}
