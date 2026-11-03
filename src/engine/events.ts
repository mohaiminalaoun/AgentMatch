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

// Transport diagnostics contain identifiers and categories, never prompts, replies, or credentials.
export const MailboxDiagnostic = z.object({
	type: z.literal("mailbox"),
	time: z.string(),
	agent: z.string(),
	requestId: z.string(),
	kind: z.string(),
	level: z.number().int(),
	attempt: z.number().int().positive(),
	elapsedMs: z.number().nonnegative(),
	status: z.enum([
		"pending",
		"notified",
		"notification_failed",
		"answered",
		"retry",
		"poll_error",
		"fallback",
		"completed",
	]),
	reason: z
		.enum([
			"timeout",
			"mailbox_error",
			"webhook_error",
			"invalid_json",
			"schema_failure",
			"disclosure_rejection",
			"rule_rejection",
		])
		.optional(),
});
export type MailboxDiagnostic = z.infer<typeof MailboxDiagnostic>;

// Everything that happens in a run, in order. `runRound` emits these; a run log is a list of them,
// and the UI and replay will read the same stream. Rationales are private to each agent's human:
// this is the operator's complete view, which is why logs stay out of git.
export const RunEvent = z.discriminatedUnion("type", [
	MailboxDiagnostic,
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
		// The project card; missing in older logs and fallbacks.
		problem: z.string().optional(),
		build: z.string().optional(),
		rolesNeeded: z.array(z.string()),
		roleWork: z.record(z.string(), z.string()).optional(),
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
		// The note the steer rests on, numbered from 1; and whether code made an uncited steer neutral.
		evidence: z.number().int().optional(),
		unfounded: z.boolean().optional(),
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
		// Everyone the owner reached level 2 with who wasn't ready to be offered a place, and why.
		excluded: z
			.array(z.object({ id: z.string(), reason: z.string() }))
			.optional(),
		// Before there was a team: the one version the owner's model wrote for everyone offered, when the
		// versions agreed with each would have kept some of them out. Every offer carried it.
		teamVersion: Terms.optional(),
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
	// At the deadline, a member said whether they're confident in their group: `ask` 1 for everyone, 2 for the
	// rest of a group someone dropped out of. Not confident means they dropped out.
	z.object({
		type: z.literal("lock"),
		agent: z.string(),
		team: z.string(),
		ask: z.union([z.literal(1), z.literal(2)]),
		confident: z.boolean(),
		rationale: z.string().optional(),
		fellBack: z.boolean(),
	}),
	// A team formed, gained a member, or lost one.
	z.object({ type: z.literal("team"), team: Team }),
	// Agents that think with a brain of their own instead of the shared model, by id: "mailbox:<name>" for an
	// outside agent answering through the mailbox as <name>, otherwise the model it uses. Emitted once, before
	// anything else, by runs where some agents have one (`withBrains`).
	z.object({
		type: z.literal("brains"),
		agents: z.record(z.string(), z.string()),
	}),
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
		requestId: z.string().optional(),
		time: z.string(),
		messages: z.array(
			z.object({
				role: z.enum(["system", "user", "assistant"]),
				content: z.string(),
			}),
		),
		reply: z.string(),
		// The model that answered; missing in older logs.
		model: z.string().optional(),
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
		...(exchange.requestId ? { requestId: exchange.requestId } : {}),
		time: new Date().toISOString(),
		messages: [...exchange.messages],
		reply: exchange.reply,
		model: exchange.model,
		usage: exchange.usage,
	};
}
