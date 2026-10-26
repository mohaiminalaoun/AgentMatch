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

const ResponseEnvelope = z.object({
	proposalId: z.string().min(1),
	from: z.string().min(1),
	to: z.string().min(1),
});

// Named ProposalResponse so it doesn't shadow the global fetch `Response`.
export const ProposalResponse = z.discriminatedUnion("decision", [
	ResponseEnvelope.extend({ decision: z.literal("accept") }),
	ResponseEnvelope.extend({ decision: z.literal("counter"), ...Terms.shape }),
	ResponseEnvelope.extend({
		decision: z.literal("decline"),
		reason: z.string().optional(),
	}),
]);

export type ProposalResponse = z.infer<typeof ProposalResponse>;
