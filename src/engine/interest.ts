import { z } from "zod";
import { aboutHuman } from "./notes.js";
import {
	agreedTerms,
	contactOf,
	MAX_REVISIONS,
	revisionsWith,
	type AgentState,
} from "./agent.js";
import type { LlmClient } from "./client.js";
import { describeViolation, disclosureRules } from "./decision.js";
import type { DisclosureLevel } from "./disclosure.js";
import { checkDisclosure, draftOf } from "./gate.js";
import { steerText, type Hunch } from "./hunch.js";
import {
	StructuredOutputError,
	type ChatJsonOptions,
	type Message,
	type TokenUsage,
} from "./llm.js";
import { Terms, type Revision } from "./proposal.js";

// What the model returns after learning a share: private reasoning, then a yes or no, and optionally, with a
// yes, a reshaped version of the project to propose.
export const AgentInterest = z.object({
	rationale: z.string().min(1),
	interest: z.enum(["continue", "withdraw"]),
	revision: Terms.optional(),
});

export type AgentInterest = z.infer<typeof AgentInterest>;

export type InterestResult = {
	interest: AgentInterest["interest"];
	// A reshaped version of the project to send with the continue; always passed by the gate.
	revision?: Terms | undefined;
	// How many times the gate stopped a revision from going out.
	gateBlocks: number;
	// The private hunch that steered this check, for agents with "never" notes.
	hunch?: Hunch | undefined;
	// Why, for the agent's own human and logs only; never sent. Missing if no valid reply came back.
	rationale: string | undefined;
	// True when no valid reply came back and the agent withdrew to be safe.
	fellBack: boolean;
	usage: TokenUsage | undefined;
};

// What to weigh at each level, given what has just been shared.
const WEIGHING: Record<number, string> = {
	1: "Their interests and availability are now known. Can they actually work together: are the time zones close enough to overlap, and does each have enough hours? Shared interests help, but don't withdraw over interests alone: their skills, shared next, may still fit what's needed.",
	2: "Their skills and preferences are now known. Do their skills complement your human's, covering roles your human can't? Do their preferred roles and team size fit?",
	3: "Their name is now known. Is there any reason not to form a team?",
};

// Whether `agent` may propose a revision to `otherId` at `level`: level 1 or 2, while revisions are left.
export function mayRevise(
	agent: AgentState,
	otherId: string,
	level: DisclosureLevel,
): boolean {
	return (
		(level === 1 || level === 2) &&
		revisionsWith(agent, otherId) < MAX_REVISIONS
	);
}

// The prompt asking `agent` whether to keep going with `otherId` at `level` (the level of the share it just
// learned; its own contact may not show it open yet), built from its own profile and only what the other
// side has shared with it so far. While revisions are allowed, it may also propose a reshaped version of the
// project, under the disclosure rules for that level.
export function interestMessages(
	agent: AgentState,
	otherId: string,
	level: DisclosureLevel = contactOf(agent, otherId).level,
	// A private hunch, which adds only a fixed sentence for its steer.
	hunch?: Hunch,
): Message[] {
	const contact = contactOf(agent, otherId);
	const revise = mayRevise(agent, otherId, level);
	const steer = steerText(hunch, "interest");
	const agreed = agreedTerms(agent, otherId);
	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				aboutHuman(agent, level),
				[
					`You and agent ${otherId} both agreed to keep talking and are now at level ${level}.`,
					WEIGHING[level] ?? "",
					"Decide whether to keep going toward a team (continue) or stop here (withdraw).",
					"Be selective: your human has limited time, and a weak match blocks a better one.",
					revise
						? "Only continue or withdraw is sent, plus a revision if you add one; your rationale is private, so explain yourself fully there."
						: "Only the single word continue or withdraw is sent; your rationale is private, so explain yourself fully there.",
				].join("\n"),
				...(revise
					? [
							[
								"Optional, only with continue: if what you've learned suggests a better version of the project, one that fits both humans better, add a revision: a new one-line pitch and the roles it needs from people other than your human. They'll adopt it or keep the current version. Leave it out if the current version is fine.",
								"A revision is sent, so it follows the disclosure rules. Describe the idea, not the people.",
								disclosureRules(level),
							].join("\n"),
						]
					: []),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`The version of the project you've agreed on: ${JSON.stringify(agreed ?? "none yet")}`,
				`What agent ${otherId} has shared with you so far: ${JSON.stringify(contact.learned)}`,
				`Messages between you so far: ${JSON.stringify(contact.history)}`,
				...(level === 2 && agreed
					? [
							`A team only forms if someone fills a role the version you've agreed on needs (${agreed.rolesNeeded.join(", ")}, from people other than whoever proposed it). Continue only if one of you does, or add a revision whose roles fit you both; otherwise no offer can follow, however well you get along.`,
						]
					: []),
				...(steer ? [steer] : []),
				"Keep going, or withdraw?",
			].join("\n"),
		},
	];
}

// Asks `agent`'s model whether to keep going with `otherId`. If no valid answer comes back, withdraws:
// stopping is the safe default, since continuing would share more.
export async function checkInterest(
	client: LlmClient,
	agent: AgentState,
	otherId: string,
	// The level of the share that prompted the check; defaults to the contact's current level.
	level: DisclosureLevel = contactOf(agent, otherId).level,
	options: ChatJsonOptions<AgentInterest> = {},
	// A private hunch from the agent's "never" notes: "stop" withdraws with no call.
	hunch?: Hunch,
): Promise<InterestResult> {
	let gateBlocks = 0;
	if (hunch?.steer === "stop") {
		return {
			interest: "withdraw",
			rationale: undefined,
			gateBlocks,
			fellBack: false,
			usage: undefined,
			hunch,
		};
	}
	try {
		const { data, usage } = await client.chatJson(
			interestMessages(agent, otherId, level, hunch),
			AgentInterest,
			{
				...options,
				check: ({ interest, revision }) => {
					if (!revision) {
						return [];
					}
					if (interest !== "continue") {
						return ["a revision only goes with continue"];
					}
					if (!mayRevise(agent, otherId, level)) {
						return [
							"no revisions are allowed now; leave the revision out",
						];
					}
					const violations = checkDisclosure(
						agent.profile,
						level,
						draftOf(revision),
					);
					if (violations.length > 0) {
						gateBlocks++;
					}
					return violations.map((v) => describeViolation(v, level));
				},
			},
		);
		return {
			interest: data.interest,
			revision: data.revision,
			rationale: data.rationale,
			gateBlocks,
			fellBack: false,
			usage,
			hunch,
		};
	} catch (error) {
		if (!(error instanceof StructuredOutputError)) {
			throw error;
		}
		return {
			interest: "withdraw",
			rationale: undefined,
			gateBlocks,
			fellBack: true,
			usage: undefined,
			hunch,
		};
	}
}

// What the model returns about a revision it received: adopt it, or keep the current version.
export const AgentAdopt = z.object({
	rationale: z.string().min(1),
	adopt: z.boolean(),
});

export type AgentAdopt = z.infer<typeof AgentAdopt>;

export type AdoptResult = {
	adopt: boolean;
	// Why, for the agent's own human and logs only; never sent.
	rationale: string | undefined;
	// True when no valid reply came back and the current version was kept.
	fellBack: boolean;
};

// The prompt asking `agent` whether to adopt `revision`: its own profile, the version agreed so far, the
// revision, and what the other side has shared.
export function revisionMessages(
	agent: AgentState,
	revision: Revision,
): Message[] {
	const contact = contactOf(agent, revision.from);
	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				aboutHuman(agent, contact.level),
				[
					`Agent ${revision.from} proposes a reshaped version of the project you've been discussing.`,
					"Adopt it if it's a better project for your human to build with them; otherwise keep the current version. Keeping doesn't end the conversation.",
					"Only adopt or keep is sent; your rationale is private.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`The version you've agreed on so far: ${JSON.stringify(agreedTerms(agent, revision.from) ?? "none yet")}`,
				`Their revision: ${JSON.stringify({ pitch: revision.pitch, rolesNeeded: revision.rolesNeeded })}`,
				`What agent ${revision.from} has shared with you so far: ${JSON.stringify(contact.learned)}`,
				"Adopt the revision, or keep the current version?",
			].join("\n"),
		},
	];
}

// Asks `agent`'s model whether to adopt `revision`. If no valid answer comes back, keeps the current version:
// nothing changes, which is the safe default.
export async function considerRevision(
	client: LlmClient,
	agent: AgentState,
	revision: Revision,
	options: ChatJsonOptions<AgentAdopt> = {},
): Promise<AdoptResult> {
	try {
		const { data } = await client.chatJson(
			revisionMessages(agent, revision),
			AgentAdopt,
			options,
		);
		return {
			adopt: data.adopt,
			rationale: data.rationale,
			fellBack: false,
		};
	} catch (error) {
		if (!(error instanceof StructuredOutputError)) {
			throw error;
		}
		return { adopt: false, rationale: undefined, fellBack: true };
	}
}
