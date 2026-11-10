// A made-up `commit` request for an outside agent, built the way the arena builds a real one: the engine's own
// commitment prompt (`commitmentMessages`), the mailbox preface, and the reply schema as the mailbox brain
// derives it. For trying out how an outside agent handles the request kind it has to answer when team offers
// are on the table, without running a whole pilot to get there. Synthetic people only.
import { z } from "zod";
import { createAgent } from "../engine/agent.js";
import { AgentCommitment, commitmentMessages } from "../engine/commitment.js";
import { promptText } from "../engine/mailbox-brain.js";
import type { Profile } from "../engine/profile.js";
import type { Offer } from "../engine/proposal.js";

const person = (id: string, interests: string[]): Profile => ({
	id,
	name: "Sample Person",
	skills: [
		{ name: "backend", level: "intermediate" },
		{ name: "data", level: "beginner" },
	],
	interests,
	projectIdeas: [],
	availability: { hoursPerWeek: 12, utcOffset: -5 },
	preferences: {
		minTeamSize: 2,
		maxTeamSize: 4,
		preferredRoles: ["backend"],
	},
});

const offer = (
	from: string,
	to: string,
	title: string,
	pitch: string,
	rolesNeeded: string[],
): Offer => ({
	kind: "offer",
	from,
	to,
	team: `team-${from}`,
	title,
	pitch,
	problem: "People forget to follow up on small commitments.",
	build: "A weekend prototype with a simple web front end and an API.",
	rolesNeeded,
});

export const COMMIT_OWNERS = ["p-owner-a", "p-owner-b"];

// "mixed": two ordinary offers, one in health and one in study tools. "fit": the first offer is an open-source
// developer-tools project that needs a backend person, with a team of three; the second is the same study tool.
// Whether an agent joins the first is its own judgment, but a sound agent has real reason to.
export type CommitVariant = "mixed" | "fit";

// `agent` is the mailbox agent the request is left for; the sample person's id is its own.
export function commitSampleRequest(
	agent: string,
	now = Date.now(),
	variant: CommitVariant = "mixed",
) {
	const me = person(
		`p-sample-${agent}`,
		variant === "fit"
			? ["developer tools", "education", "open source"]
			: ["health", "education"],
	);
	const held = [
		variant === "fit"
			? offer(
					"p-owner-a",
					me.id,
					"Dev Tool Dojo",
					"An open-source tool that teaches developers command-line and editor tools through short interactive exercises.",
					["backend", "frontend"],
				)
			: offer(
					"p-owner-a",
					me.id,
					"Habit Nudge",
					"A reminder service that helps people keep small health habits.",
					["backend", "frontend"],
				),
		offer(
			"p-owner-b",
			me.id,
			"Study Buddy",
			"A matching tool that pairs students who want to study the same topic.",
			["backend", "design"],
		),
	];
	const messages = commitmentMessages(createAgent(me), held, [], {
		sizes: { "p-owner-a": variant === "fit" ? 3 : 2, "p-owner-b": 3 },
	});
	return {
		id: `seed-${agent}-commit-${variant === "fit" ? "fit-" : ""}${now.toString(36)}`,
		agent,
		kind: "commit",
		level: 2,
		deadline: new Date(now + 3 * 60 * 60_000).toISOString(),
		replySchema: z.toJSONSchema(AgentCommitment, {
			io: "input",
			unrepresentable: "any",
		}) as Record<string, unknown>,
		prompt: promptText(messages),
	};
}

// What the arena would say about a reply: it must match the schema, and `commit` must be one of the two owners
// offered, or null to decline. Empty means accepted.
export function commitSampleProblems(reply: unknown): string[] {
	const parsed = AgentCommitment.safeParse(reply);
	if (!parsed.success) {
		return parsed.error.issues.map(
			(i) => `${i.path.join(".") || "reply"}: ${i.message}`,
		);
	}
	const { commit } = parsed.data;
	return commit === null || COMMIT_OWNERS.includes(commit)
		? []
		: [
				`commit must be ${COMMIT_OWNERS.join(", ")}, or null; got ${commit}`,
			];
}
