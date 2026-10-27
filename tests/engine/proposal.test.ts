import { expect, test } from "vitest";
import {
	Decision,
	Proposal,
	ProposalResponse,
	STANDARD_REFUSAL,
	toResponse,
} from "../../src/engine/proposal.js";

const proposal = {
	id: "prop-1",
	from: "agent-a",
	to: "agent-b",
	pitch: "A web app startup that helps freelancers send invoices.",
	rolesNeeded: ["frontend", "backend"],
};

const envelope = { proposalId: "prop-1", from: "agent-b", to: "agent-a" };

test("a valid proposal parses", () => {
	expect(Proposal.safeParse(proposal).success).toBe(true);
});

test("a proposal with an empty pitch fails", () => {
	expect(Proposal.safeParse({ ...proposal, pitch: "" }).success).toBe(false);
});

test("a proposal with no roles fails", () => {
	expect(Proposal.safeParse({ ...proposal, rolesNeeded: [] }).success).toBe(
		false,
	);
});

test("an accept parses", () => {
	const result = ProposalResponse.safeParse({
		...envelope,
		decision: "accept",
	});
	expect(result.success).toBe(true);
});

test("a sent decline must carry exactly the standard refusal", () => {
	const bare = { ...envelope, decision: "decline" };
	expect(
		ProposalResponse.safeParse({ ...bare, reason: STANDARD_REFUSAL })
			.success,
	).toBe(true);
	expect(ProposalResponse.safeParse(bare).success).toBe(false);
	expect(
		ProposalResponse.safeParse({
			...bare,
			reason: "My human wants climate work.",
		}).success,
	).toBe(false);
});

test("a decision's decline has no reason; one added anyway is stripped", () => {
	expect(
		Decision.parse({
			decision: "decline",
			reason: "My human wants climate work.",
		}),
	).toEqual({ decision: "decline" });
});

test("a counter carries new terms", () => {
	const result = ProposalResponse.parse({
		...envelope,
		decision: "counter",
		pitch: "I'd consider building the platform for a climate project.",
		rolesNeeded: ["backend"],
	});
	// Checking `decision` narrows the type, so `pitch` is only reachable on a counter.
	if (result.decision !== "counter") throw new Error("expected a counter");
	expect(result.pitch).toContain("climate");
});

test("a counter without terms fails", () => {
	const result = ProposalResponse.safeParse({
		...envelope,
		decision: "counter",
	});
	expect(result.success).toBe(false);
});

test("an unknown decision fails", () => {
	const result = ProposalResponse.safeParse({
		...envelope,
		decision: "maybe",
	});
	expect(result.success).toBe(false);
});

test("a decision alone has no envelope fields", () => {
	expect(Decision.safeParse({ decision: "accept" }).success).toBe(true);
	expect(Decision.safeParse({ decision: "maybe" }).success).toBe(false);
});

test("toResponse addresses the reply back to the proposer", () => {
	const response = toResponse(Proposal.parse(proposal), {
		decision: "decline",
	});
	expect(response).toEqual({
		decision: "decline",
		proposalId: "prop-1",
		from: "agent-b",
		to: "agent-a",
		reason: STANDARD_REFUSAL,
	});
	expect(ProposalResponse.safeParse(response).success).toBe(true);
});
