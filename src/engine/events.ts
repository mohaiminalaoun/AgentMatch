import { z } from "zod";
import { validateMessage } from "./bus.js";
import { DisclosureLevel } from "./disclosure.js";
import type { Exchange } from "./llm.js";
import { Decision } from "./proposal.js";

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
