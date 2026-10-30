import { z } from "zod";
import { aboutHuman } from "./notes.js";
import {
	agreedTerms,
	brainstormedWith,
	contactOf,
	MAX_REVISIONS,
	revisionsWith,
	type AgentState,
} from "./agent.js";
import type { LlmClient } from "./client.js";
import { describeViolation, disclosureRules } from "./decision.js";
import type { DisclosureLevel } from "./disclosure.js";
import { factsText, fitFacts } from "./fit.js";
import { checkDisclosure, draftOf } from "./gate.js";
import { CITE_FACTS, GOOD_TEAM } from "./goals.js";
import { steerText, type Hunch } from "./hunch.js";
import {
	StructuredOutputError,
	type ChatJsonOptions,
	type Message,
	type TokenUsage,
} from "./llm.js";
import {
	BRAINSTORM_PITCH,
	RevisionTerms,
	termsOf,
	type Revision,
	type RoleCover,
} from "./proposal.js";

// What the model returns after learning a share: private reasoning, then a yes or no, and optionally, with a
// yes, a reshaped version of the project to propose.
export const AgentInterest = z.object({
	rationale: z.string().min(1),
	interest: z.enum(["continue", "withdraw"]),
	revision: RevisionTerms.optional(),
});

export type AgentInterest = z.infer<typeof AgentInterest>;

export type InterestResult = {
	interest: AgentInterest["interest"];
	// A reshaped version of the project to send with the continue; always passed by the gate.
	revision?: RevisionTerms | undefined;
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
	1: "Their interests and availability are now known (see the facts). Is this still worth learning more about? Their skills come next, so weigh what you know now without guessing at skills.",
	2: "Their skills and preferences are now known (see the facts). Weigh everything together against the standard above: the project, interests, logistics, who can do each role and has the time, and team size.",
	3: "Their name is now known. Is there any reason not to form a team?",
};

// What's wrong with a revision's covers, if anything: at level 1 there must be none, since they say who has
// which skill; at level 2 they must account for every role the new version needs and every role the agreed
// version needed, rolesNeeded must be exactly the roles marked recipient or open, and every skill claimed must
// be in the proposer's profile or in what the recipient shared.
export function coverProblems(
	agent: AgentState,
	otherId: string,
	level: DisclosureLevel,
	revision: RevisionTerms,
): string[] {
	const { covers } = revision;
	if (level < 2) {
		return covers
			? ["leave covers out: skills aren't shared until level 2"]
			: [];
	}
	if (!covers || covers.length === 0) {
		return [
			"at level 2, a revision must list covers: who covers each role the new version needs, and each role the version you've agreed on needed",
		];
	}
	const by = new Map(covers.map((c) => [c.role, c.by]));
	const agreed = agreedTerms(agent, otherId);
	const before =
		agreed && agreed.pitch !== BRAINSTORM_PITCH ? agreed.rolesNeeded : [];
	const mine = new Set(agent.profile.skills.map((s) => s.name));
	const theirs = new Set(
		(contactOf(agent, otherId).learned.skills ?? []).map((s) => s.name),
	);
	const fromOthers = (c: RoleCover["by"] | undefined) =>
		c === "recipient" || c === "open";
	const problems: string[] = [];
	for (const role of revision.rolesNeeded.filter((r) => r !== "any")) {
		if (!fromOthers(by.get(role))) {
			problems.push(
				`rolesNeeded lists ${role}, so covers must mark it "recipient" or "open"`,
			);
		}
	}
	for (const c of covers) {
		if (fromOthers(c.by) && !revision.rolesNeeded.includes(c.role)) {
			problems.push(
				`covers marks ${c.role} "${c.by}", so rolesNeeded must list it`,
			);
		}
		if (c.by === "proposer" && !mine.has(c.role)) {
			problems.push(`your human has no ${c.role} skill`);
		}
		if (c.by === "recipient" && !theirs.has(c.role)) {
			problems.push(`agent ${otherId} hasn't shared a ${c.role} skill`);
		}
	}
	for (const role of before.filter((r) => r !== "any" && !by.has(r))) {
		problems.push(
			`the version you've agreed on needed ${role}: say in covers who covers it now, or mark it "dropped"`,
		);
	}
	return problems;
}

// Who covers each role in `covers`, as `reader` sees a revision from `proposer`.
export function coversText(
	covers: readonly RoleCover[],
	proposer: string,
): string {
	const who: Record<RoleCover["by"], string> = {
		proposer: `${proposer}'s human`,
		recipient: "your human",
		open: "nobody yet",
		dropped: "no longer needed",
	};
	return covers.map((c) => `${c.role}: ${who[c.by]}`).join("; ");
}

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

// Whether `agent` is at level 2 of a brainstorm with `otherId`, with an idea agreed and a revision left: then,
// with skills now known, an idea that fits neither of them may be reshaped around both instead of dropped.
function reshaping(
	agent: AgentState,
	otherId: string,
	level: DisclosureLevel,
): boolean {
	const agreed = agreedTerms(agent, otherId);
	return (
		level === 2 &&
		mayRevise(agent, otherId, level) &&
		brainstormedWith(agent, otherId) &&
		agreed !== undefined &&
		agreed.pitch !== BRAINSTORM_PITCH
	);
}

// The roles `otherId` has shared a skill in at intermediate level or above.
function strongRoles(agent: AgentState, otherId: string): string[] {
	return (contactOf(agent, otherId).learned.skills ?? [])
		.filter((skill) => skill.level !== "beginner")
		.map((skill) => skill.name);
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
	const reshape = reshaping(agent, otherId, level);
	const strong = strongRoles(agent, otherId);
	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				aboutHuman(agent, level),
				GOOD_TEAM,
				factsText(fitFacts(agent, otherId)),
				[
					`You and agent ${otherId} both agreed to keep talking and are now at level ${level}.`,
					WEIGHING[level] ?? "",
					"Decide whether to keep going toward a team (continue) or stop here (withdraw).",
					...(reshape
						? [
								"Neither human has a team yet, so reshaping the idea to fit you both is worth trying, but a team that doesn't really fit is worse than none.",
							]
						: []),
					revise
						? "Only continue or withdraw is sent, plus a revision if you add one; your rationale is private, so explain yourself fully there."
						: "Only the single word continue or withdraw is sent; your rationale is private, so explain yourself fully there.",
					CITE_FACTS,
				].join("\n"),
				...(revise
					? [
							[
								"Optional, only with continue: if what you've learned suggests a better version of the project, one that fits both humans better, add a revision: a short title for it (1 to 4 words, like a product name), a new one-line pitch, and the roles it needs from people other than your human. The pitch describes the project itself, as it would appear on the team's page: not a message to them, no questions, no \"how about\". They'll adopt it or keep the current version. Leave it out if the current version is fine.",
								"A revision is sent, so it follows the disclosure rules. Describe the idea, not the people.",
								level === 2
									? `At this level, a revision also lists covers: for every role the new version needs, and every role the version you've agreed on needed, who covers it: "proposer" (your human), "recipient" (agent ${otherId}'s human), "open" (still needs someone), or "dropped" (the new version doesn't need it). rolesNeeded is exactly the roles marked recipient or open. Claim only skills that are listed: your human's in their profile, theirs in what they shared.`
									: "Leave covers out at this level: skills aren't shared yet.",
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
				...(agreed?.pitch === BRAINSTORM_PITCH
					? [
							"You're brainstorming: no idea is agreed yet. Once you know enough about each other, propose a revision: one idea that fits both humans. No team can form until you agree on one.",
						]
					: []),
				...(reshape
					? [
							`You've been brainstorming, and the idea you agreed on needs ${agreed!.rolesNeeded.join(", ")} from whoever didn't propose it. A team only forms if someone fills one of those roles. If one of you does, judge it as usual. If neither does, you may continue with a revision that reshapes the idea around what you can both do: it must need a role agent ${otherId} is strong in (${strong.length > 0 ? strong.join(", ") : "they have none"}), and give your human work in their strongest skill too. If no such project exists, or your hours, time zones, or team sizes don't fit, withdraw.`,
						]
					: level === 2 && agreed && agreed.pitch !== BRAINSTORM_PITCH
						? [
								`A team only forms if someone fills a role the version you've agreed on needs (${agreed.rolesNeeded.join(", ")}, from people other than whoever proposed it). If neither of you can do one of those roles, a revision may change them only when the work itself changes, and its pitch must say how; don't relabel roles just so an offer becomes possible. Otherwise withdraw: no offer can follow, however well you get along.`,
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
					const coverIssues = coverProblems(
						agent,
						otherId,
						level,
						revision,
					);
					if (coverIssues.length > 0) {
						return coverIssues;
					}
					// A reshaped brainstorm idea has to use what the other person is actually good at.
					if (
						reshaping(agent, otherId, level) &&
						!revision.rolesNeeded.some((r) =>
							strongRoles(agent, otherId).includes(r),
						)
					) {
						return [
							`a reshaped idea must need a role agent ${otherId} is strong in (${strongRoles(agent, otherId).join(", ") || "none"}); if there's no such project, withdraw instead`,
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
				GOOD_TEAM,
				factsText(fitFacts(agent, revision.from)),
				[
					`Agent ${revision.from} proposes a reshaped version of the project you've been discussing.`,
					"Adopt it if it's a better project for your human to build with them; otherwise keep the current version. Keeping doesn't end the conversation.",
					"Only adopt or keep is sent; your rationale is private.",
					CITE_FACTS,
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`The version you've agreed on so far: ${JSON.stringify(agreedTerms(agent, revision.from) ?? "none yet")}`,
				`Their revision: ${JSON.stringify(termsOf(revision))}`,
				...(revision.covers
					? [
							`Who covers each role, as they propose it: ${coversText(revision.covers, revision.from)}. Check it against the facts. A role marked "no longer needed" is work the new version leaves out: judge whether the project still holds up without it.`,
						]
					: []),
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
