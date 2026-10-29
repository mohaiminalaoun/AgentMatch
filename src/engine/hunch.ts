import { z } from "zod";
import { contactOf, type AgentState } from "./agent.js";
import type { LlmClient } from "./client.js";
import {
	StructuredOutputError,
	type ChatJsonOptions,
	type Message,
} from "./llm.js";

// How a private hunch steers a decision. Only these fixed words leave the hunch call, never its reasoning.
export const Steer = z.enum(["neutral", "explore", "careful", "stop"]);
export type Steer = z.infer<typeof Steer>;

// What a careful hunch is most wary of, from a fixed list of generic topics.
export const RiskArea = z.enum([
	"retention",
	"scope",
	"market",
	"team",
	"timeline",
	"technical",
]);
export type RiskArea = z.infer<typeof RiskArea>;

// What the model returns from a hunch call: private reasoning, then a steer and an optional risk area.
export const AgentHunch = z.object({
	rationale: z.string().min(1),
	steer: Steer,
	riskArea: RiskArea.nullable(),
});

export type AgentHunch = z.infer<typeof AgentHunch>;

export type Hunch = {
	steer: Steer;
	riskArea: RiskArea | null;
	// Why, for the agent's own human and logs only. It may draw on "never" notes, so it never reaches any
	// other prompt or message: only `steer` and `riskArea` do, through fixed text.
	rationale: string | undefined;
	// True when no valid reply came back and the hunch defaulted to neutral.
	fellBack: boolean;
};

// Whether `agent` has notes it may never draw on in anything sent: only then is a hunch call worth making.
export function hasDeepNotes(agent: AgentState): boolean {
	return agent.notes.some((note) => note.level === "never");
}

// The prompt for a private hunch about `otherId`: the human's profile and every note, "never" ones included,
// plus `situation`, what is being decided. Nothing from it is ever sent; only the steer it picks is used.
export function hunchMessages(
	agent: AgentState,
	otherId: string,
	situation: string,
): Message[] {
	return [
		{
			role: "system",
			content: [
				"You are the private judgment of an AI agent forming hackathon teams for one person, your human. Act in their interest.",
				`Your human's full profile:\n${JSON.stringify(agent.profile, null, 2)}`,
				`Everything your human has told you, including things never to be shared:\n${agent.notes.map((note) => `- ${note.text}`).join("\n")}`,
				[
					"Nothing you write here is sent or shown to the other agent's side. Only your steer is used, as one of these words:",
					"- neutral: nothing your human has told you bears on this.",
					"- explore: something here may fit better than it looks; keep going rather than say no early.",
					"- careful: your human has reasons to be wary; probe before agreeing.",
					"- stop: this is a bad fit for your human, for reasons the other side can't see.",
					"With careful, name the risk area it's mostly about, or null. Explain yourself fully in the rationale.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`Agent ${otherId} has shared so far: ${JSON.stringify(contactOf(agent, otherId).learned)}`,
				situation,
				"What's your steer?",
			].join("\n"),
		},
	];
}

// Asks for a private hunch about `otherId`, for an agent with "never" notes; undefined otherwise, with no call
// made. If no valid answer comes back, the hunch is neutral: it then changes nothing.
export async function getHunch(
	client: LlmClient,
	agent: AgentState,
	otherId: string,
	situation: string,
	options: ChatJsonOptions<AgentHunch> = {},
): Promise<Hunch | undefined> {
	if (!hasDeepNotes(agent)) {
		return undefined;
	}
	try {
		const { data } = await client.chatJson(
			hunchMessages(agent, otherId, situation),
			AgentHunch,
			options,
		);
		return {
			steer: data.steer,
			riskArea: data.steer === "careful" ? data.riskArea : null,
			rationale: data.rationale,
			fellBack: false,
		};
	} catch (error) {
		if (!(error instanceof StructuredOutputError)) {
			throw error;
		}
		return {
			steer: "neutral",
			riskArea: null,
			rationale: undefined,
			fellBack: true,
		};
	}
}

// The fixed sentence a hunch adds to a decision ("decision") or interest check ("interest"), if any. Written
// here, not by a model, so the only things that cross from the hunch are its steer and risk area.
export function steerText(
	hunch: Hunch | undefined,
	context: "decision" | "interest",
): string | undefined {
	const about = hunch?.riskArea
		? `, especially around ${hunch.riskArea}`
		: "";
	switch (hunch?.steer) {
		case "explore":
			return context === "decision"
				? "Your human has private reasons to think this could fit better than it looks. Prefer accepting or countering over declining, so you can learn more."
				: "Your human has private reasons to think this could fit better than it looks. Prefer continuing over withdrawing, so you can learn more.";
		case "careful":
			return context === "decision"
				? `Your human has private reasons for caution about this${about}. Don't accept it as is: counter with a question or change that addresses it, or decline.`
				: `Your human has private reasons for caution about this${about}. If you continue, consider a revision that addresses it.`;
		default:
			return undefined;
	}
}
