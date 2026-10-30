import { z } from "zod";
import { FIELD_LEVELS, type ProfileField } from "./disclosure.js";
import { Profile } from "./profile.js";

// What is being offered. Proposals and counters both carry these terms.
export const Terms = z.object({
	// A short name for the project, written with the version and agreed with it. Optional, since older logs
	// and fallback pitches have none.
	title: z.string().min(1).max(60).optional(),
	// One line, the level-0 pitch.
	pitch: z.string().min(1).max(280),
	rolesNeeded: z.array(z.string().min(1)).min(1),
});

export type Terms = z.infer<typeof Terms>;

// Just the terms of `message`: its title, if it has one, its pitch, and its roles.
export function termsOf(message: Terms): Terms {
	return {
		...(message.title !== undefined && { title: message.title }),
		pitch: message.pitch,
		rolesNeeded: message.rolesNeeded,
	};
}

// The model-written words of some terms, for the gate and for spotting fields mentioned: title and pitch.
export function termsText(terms: Terms): string {
	return [terms.title, terms.pitch].filter(Boolean).join(" ");
}

export const Proposal = Terms.extend({
	id: z.string().min(1),
	from: z.string().min(1),
	to: z.string().min(1),
	// How many committed teams the proposer's human has left, if any. Filled in by code from the
	// proposer's state, never by a model, so the recipient can weigh reliability.
	leftTeams: z.number().int().min(1).optional(),
	// Set by code when the proposer has no project and asks to join the recipient's: the terms are then the
	// recipient's own listing, and its roles are what the recipient's project needs, not what the proposer offers.
	join: z.literal(true).optional(),
});

export type Proposal = z.infer<typeof Proposal>;

// How a proposal from someone with no project idea starts: they're asking to join the recipient's project.
export const JOIN_PREFIX = "Join your project: ";

// Whether `message` asks to join the recipient's project: marked with `join`, or, in logs from before the
// mark existed, starting with JOIN_PREFIX.
export function isJoinRequest(message: {
	pitch: string;
	join?: true | undefined;
}): boolean {
	return message.join === true || message.pitch.startsWith(JOIN_PREFIX);
}

// The pitch of a brainstorm proposal, made between people left without a team: an invitation to come up with
// a project together. Agreeing to it agrees to brainstorm, not to an idea.
export const BRAINSTORM_PITCH = "Let's come up with a project together.";

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
// continued through level 2). It carries the version of the project the team will build, which the
// recipient commits to. Once sent, the owner can't take it back: a commit puts them on the team.
export const Offer = Terms.extend({
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

// A reshaped version of the project, proposed alongside a continue once level 1 or 2 is open, when what each
// side has learned suggests a better idea for both. Free text, so gate-checked like a counter at the
// sender's level. It doesn't change whose project it is.
export const Revision = Terms.extend({
	kind: z.literal("revision"),
	from: z.string().min(1),
	to: z.string().min(1),
	level: z.literal([1, 2, 3]),
});

export type Revision = z.infer<typeof Revision>;

// The answer to a revision: adopt it as the agreed version, or keep the current one. No text, and keeping
// doesn't end the conversation.
export const RevisionAnswer = z.object({
	kind: z.literal("revisionAnswer"),
	from: z.string().min(1),
	to: z.string().min(1),
	adopt: z.boolean(),
});

export type RevisionAnswer = z.infer<typeof RevisionAnswer>;
