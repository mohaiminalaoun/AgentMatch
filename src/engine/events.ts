import { z } from "zod";
import { validateMessage } from "./bus.js";
import { DisclosureLevel } from "./disclosure.js";
import type { Exchange } from "./llm.js";
import { RiskArea, Steer } from "./hunch.js";
import { Decision, RevisionTerms, Terms } from "./proposal.js";
import { Team } from "./team.js";

// A bus message, checked with the same rules the bus uses when it's sent.
const LoggedMessage = z.unknown().transform((message, ctx) => {
	const result = validateMessage(message);
	if (typeof result === "string") {
		ctx.addIssue({ code: "custom", message: result });
		return z.NEVER;
	}
	return result;
});

const LoggedBusEvent = z.discriminatedUnion("type", [
	z.object({
		seq: z.number(),
		time: z.string(),
		type: z.literal("sent"),
		message: LoggedMessage,
	}),
	z.object({
		seq: z.number(),
		time: z.string(),
		type: z.literal("rejected"),
		from: z.string(),
		reason: z.string(),
	}),
]);

// Everything that happens in a run, in order. `runRound` emits these; a run log is a list of them,
// and the UI and replay will read the same stream. Rationales are private to each agent's human:
// this is the operator's complete view, which is why logs stay out of git.
export const RunEvent = z.discriminatedUnion("type", [
	// A call to runRound began.
	z.object({
		type: z.literal("round"),
		time: z.string(),
		model: z.string(),
		agents: z.array(z.string()),
	}),
	// An agent's model wrote its public board listing.
	z.object({
		type: z.literal("listing"),
		agent: z.string(),
		// Missing in older logs.
		title: z.string().optional(),
		pitch: z.string(),
		rolesNeeded: z.array(z.string()),
		rationale: z.string().optional(),
		gateBlocks: z.number().int(),
		fellBack: z.boolean(),
	}),
	// An agent looked at the public board and chose whom to approach.
	z.object({
		type: z.literal("discovery"),
		agent: z.string(),
		approach: z.array(z.string()),
		rationale: z.string().optional(),
		fellBack: z.boolean(),
	}),
	// A tick began: every agent is about to handle its inbox.
	z.object({ type: z.literal("tick"), n: z.number().int() }),
	// Something the bus did, with its own sequence number.
	z.object({ type: z.literal("bus"), event: LoggedBusEvent }),
	// An agent's model decided on a proposal or counter.
	z.object({
		type: z.literal("decision"),
		agent: z.string(),
		proposalId: z.string(),
		decision: Decision,
		rationale: z.string().optional(),
		gateBlocks: z.number().int(),
		fellBack: z.boolean(),
	}),
	// An agent's model decided whether to keep going after learning a share.
	z.object({
		type: z.literal("interest"),
		agent: z.string(),
		other: z.string(),
		level: z.literal([1, 2, 3]),
		interest: z.enum(["continue", "withdraw"]),
		// A reshaped version of the project sent with the continue, if any.
		revision: RevisionTerms.optional(),
		// How many times the gate stopped a revision; missing in older logs.
		gateBlocks: z.number().int().optional(),
		rationale: z.string().optional(),
		fellBack: z.boolean(),
	}),
	// An agent with "never" notes formed a private hunch before deciding. Only its steer and risk area shaped
	// what was sent; the rationale is for the human's own log.
	z.object({
		type: z.literal("hunch"),
		agent: z.string(),
		other: z.string(),
		steer: Steer,
		riskArea: RiskArea.nullable(),
		rationale: z.string().optional(),
		fellBack: z.boolean(),
	}),
	// An agent decided whether to adopt a revision it received.
	z.object({
		type: z.literal("revisionAnswer"),
		agent: z.string(),
		other: z.string(),
		adopt: z.boolean(),
		rationale: z.string().optional(),
		fellBack: z.boolean(),
	}),
	// An agent opened a new level with another.
	z.object({
		type: z.literal("level"),
		agent: z.string(),
		other: z.string(),
		from: DisclosureLevel,
		to: DisclosureLevel,
	}),
	// A project owner chose whom to offer a place on its team. No model call (and no rationale) when
	// everyone ready fit in the places left.
	z.object({
		type: z.literal("offers"),
		agent: z.string(),
		to: z.array(z.string()),
		places: z.number().int(),
		rationale: z.string().optional(),
		fellBack: z.boolean(),
		// The model's own choice, best first, when it was asked; `to` is what was left after the code's checks.
		ranked: z.array(z.string()).optional(),
		// Everyone the code's checks left out of `ranked` (or, on a fallback, of everyone ready), and why.
		dropped: z
			.array(z.object({ id: z.string(), reason: z.string() }))
			.optional(),
	}),
	// An agent holding offers committed to one owner's team, or to none (`chose` null). `busy` when it had
	// offers of its own out and answered busy without a model call.
	z.object({
		type: z.literal("commitment"),
		agent: z.string(),
		offers: z.array(z.string()),
		chose: z.string().nullable(),
		busy: z.boolean().optional(),
		rationale: z.string().optional(),
		fellBack: z.boolean(),
	}),
	// After its team grew, an earlier member decided whether to stay.
	z.object({
		type: z.literal("recheck"),
		agent: z.string(),
		team: z.string(),
		decision: z.enum(["stay", "leave"]),
		rationale: z.string().optional(),
		fellBack: z.boolean(),
	}),
	// A team formed, gained a member, or lost one.
	z.object({ type: z.literal("team"), team: Team }),
	// The normal rounds are over, and the people still without a team start brainstorming together.
	z.object({ type: z.literal("brainstorm"), agents: z.array(z.string()) }),
	// A simulation ended: after a round that changed nothing, or at its round limit.
	z.object({
		type: z.literal("stopped"),
		rounds: z.number().int(),
		reason: z.enum(["stable", "limit"]),
	}),
	// One model call: everything sent, the reply, and its cost.
	z.object({
		type: z.literal("exchange"),
		time: z.string(),
		messages: z.array(
			z.object({
				role: z.enum(["system", "user", "assistant"]),
				content: z.string(),
			}),
		),
		reply: z.string(),
		usage: z
			.object({
				input: z.number(),
				output: z.number(),
				total: z.number(),
				reasoning: z.number().optional(),
				cached: z.number().optional(),
			})
			.optional(),
	}),
]);

export type RunEvent = z.infer<typeof RunEvent>;

// A model call as a run event, stamped with the current time.
export function exchangeEvent(exchange: Exchange): RunEvent {
	return {
		type: "exchange",
		time: new Date().toISOString(),
		messages: [...exchange.messages],
		reply: exchange.reply,
		usage: exchange.usage,
	};
}
