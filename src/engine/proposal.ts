import { z } from "zod";
import { FIELD_LEVELS, type ProfileField } from "./disclosure.js";
import { Profile } from "./profile.js";

// What is being offered. Proposals and counters both carry these terms.
export const Terms = z.object({
	// One line, the level-0 pitch.
	pitch: z.string().min(1).max(280),
	rolesNeeded: z.array(z.string().min(1)).min(1),
});

export type Terms = z.infer<typeof Terms>;

export const Proposal = Terms.extend({
	id: z.string().min(1),
	from: z.string().min(1),
	to: z.string().min(1),
	// How many committed teams the proposer's human has left, if any. Filled in by code from the
	// proposer's state, never by a model, so the recipient can weigh reliability.
	leftTeams: z.number().int().min(1).optional(),
});

export type Proposal = z.infer<typeof Proposal>;

// How a proposal from someone with no project idea starts: they're asking to join the recipient's project.
export const JOIN_PREFIX = "Join your project: ";

const Accept = z.object({ decision: z.literal("accept") });
const Counter = Terms.extend({ decision: z.literal("counter") });
// A decline has no reason the model can fill in: there's nowhere to put an explanation, so none can leak.
// Unknown fields are stripped when parsing, so a reason the model adds anyway is dropped.
const Decline = z.object({ decision: z.literal("decline") });

// Every decline says exactly this, whatever the real reason, so a refusal reveals nothing.
export const STANDARD_REFUSAL = "Not a fit right now.";

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
	// The code adds the standard refusal; a decline with any other reason, or none, is rejected.
	Decline.extend({
		...ResponseEnvelope.shape,
		reason: z.literal(STANDARD_REFUSAL),
	}),
]);

export type ProposalResponse = z.infer<typeof ProposalResponse>;

// Wraps a decision about `proposal` in its envelope; the reply goes from the proposal's recipient back to its sender.
// Declines get the standard refusal.
export function toResponse(
	proposal: Proposal,
	decision: Decision,
): ProposalResponse {
	const envelope = {
		proposalId: proposal.id,
		from: proposal.to,
		to: proposal.from,
	};
	return decision.decision === "decline"
		? { ...decision, ...envelope, reason: STANDARD_REFUSAL }
		: { ...decision, ...envelope };
}

// Profile data an agent hands over when both sides open a new level. Built by code from the real profile,
// never written by the model, and it may only contain fields that belong to exactly that level.
export const Share = z
	.object({
		kind: z.literal("share"),
		from: z.string().min(1),
		to: z.string().min(1),
		level: z.literal([1, 2, 3]),
		shared: Profile.partial(),
	})
	.refine(
		(share) =>
			Object.keys(share.shared).every(
				(field) => FIELD_LEVELS[field as ProfileField] === share.level,
			),
		{ error: "shared fields must all belong to the share's level" },
	);

export type Share = z.infer<typeof Share>;

// After learning a share, whether to keep going toward a team. No text, so it can't reveal anything:
// a withdrawal says no more than the standard refusal.
export const Interest = z.object({
	kind: z.literal("interest"),
	from: z.string().min(1),
	to: z.string().min(1),
	level: z.literal([1, 2, 3]),
	interest: z.enum(["continue", "withdraw"]),
});

export type Interest = z.infer<typeof Interest>;

// A binding place on a team, sent by the project's owner to someone both sides are ready with (both
// continued through level 2). No text. Once sent, the owner can't take it back: a commit puts them on the team.
export const Offer = z.object({
	kind: z.literal("offer"),
	from: z.string().min(1),
	to: z.string().min(1),
	team: z.string().min(1),
});

export type Offer = z.infer<typeof Offer>;

// The answer to an offer. A commit is final; a decline says nothing more than that, like a withdrawal, and
// ends that owner's offers to them. Busy means its own offers are out, so it may be offered again later.
export const OfferAnswer = z.object({
	kind: z.literal("answer"),
	from: z.string().min(1),
	to: z.string().min(1),
	team: z.string().min(1),
	answer: z.enum(["commit", "decline", "busy"]),
});

export type OfferAnswer = z.infer<typeof OfferAnswer>;

// A committed member leaving their team, sent to each teammate. No text; the cost is the public mark on
// the leaver (`leftTeams`), not anything said here.
export const Leave = z.object({
	kind: z.literal("leave"),
	from: z.string().min(1),
	to: z.string().min(1),
	team: z.string().min(1),
});

export type Leave = z.infer<typeof Leave>;
