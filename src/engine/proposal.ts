import { z } from "zod";

// What is being offered. Proposals and counters both carry these terms.
export const Terms = z.object({
	// One line, the level-0 pitch.
	pitch: z.string().min(1).max(280),
	rolesNeeded: z.array(z.string().min(1)).min(1),
});

export const Proposal = Terms.extend({
	id: z.string().min(1),
	from: z.string().min(1),
	to: z.string().min(1),
});

export type Proposal = z.infer<typeof Proposal>;

const Accept = z.object({ decision: z.literal("accept") });
const Counter = Terms.extend({ decision: z.literal("counter") });
const Decline = z.object({
	decision: z.literal("decline"),
	reason: z.string().optional(),
});

// The judgment call about a proposal: the only part of a response an LLM writes.
export const Decision = z.discriminatedUnion("decision", [
	Accept,
	Counter,
	Decline,
]);

export type Decision = z.infer<typeof Decision>;

// Facts the code fills in, so a model can't mistype an id or claim to be someone else.
const ResponseEnvelope = z.object({
	proposalId: z.string().min(1),
	from: z.string().min(1),
	to: z.string().min(1),
});

// Named ProposalResponse so it doesn't shadow the global fetch `Response`.
export const ProposalResponse = z.discriminatedUnion("decision", [
	Accept.extend(ResponseEnvelope.shape),
	Counter.extend(ResponseEnvelope.shape),
	Decline.extend(ResponseEnvelope.shape),
]);

export type ProposalResponse = z.infer<typeof ProposalResponse>;

// Wraps a decision about `proposal` in its envelope; the reply goes from the proposal's recipient back to its sender.
export function toResponse(
	proposal: Proposal,
	decision: Decision,
): ProposalResponse {
	return {
		...decision,
		proposalId: proposal.id,
		from: proposal.to,
		to: proposal.from,
	};
}
