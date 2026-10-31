// The deadline at the end of matching. Until now every team was a tentative group; here each member is asked
// once whether they're confident in their group. A "no" drops that person out; if anyone dropped, the rest are
// asked once more, since the group they confirmed changed. Groups left with two or more become committed, and
// only then do teammates swap names. Nobody can leave or switch groups before the deadline.
import { z } from "zod";
import {
	contactOf,
	learn,
	raiseLevel,
	recordMessage,
	recordRevealed,
	type AgentState,
} from "./agent.js";
import { brainOf, type LlmClient } from "./client.js";
import { stillNeeded } from "./commitment.js";
import { exchangeEvent, type RunEvent } from "./events.js";
import { factsText, fitFacts } from "./fit.js";
import { checkDisclosure } from "./gate.js";
import { CITE_FACTS, GOOD_TEAM } from "./goals.js";
import {
	StructuredOutputError,
	type ChatOptions,
	type Exchange,
	type Message,
} from "./llm.js";
import { aboutHuman } from "./notes.js";
import type { Profile } from "./profile.js";
import type { Leave, Share } from "./proposal.js";
import type { World } from "./round.js";
import type { Team } from "./team.js";

// What a member's model returns at the deadline.
export const AgentConfidence = z.object({
	rationale: z.string().min(1),
	confident: z.boolean(),
});

export type AgentConfidence = z.infer<typeof AgentConfidence>;

export type LockOptions = {
	// Whether teammates swap names (level 3) once their team is final (default true). With real people, names
	// wait until every member's human has approved the team, outside the engine.
	revealNames?: boolean;
	onExchange?: ChatOptions["onExchange"];
	onEvent?: (event: RunEvent) => void;
};

export type LockResult = {
	world: World;
	// Everyone who dropped out, in either ask.
	dropped: string[];
};

// The prompt asking `agent`, a member of `team`, whether its human is confident in the group: its own profile, the
// group's version, its size, the roles it still needs (`needed`, as the board shows it), and the facts about every
// member it has talked to. Members it never talked to are only a count.
export function lockMessages(
	agent: AgentState,
	team: Team,
	needed: readonly string[],
	ask: 1 | 2,
): Message[] {
	const others = team.members.filter((id) => id !== agent.id);
	const talked = others.filter(
		(id) => contactOf(agent, id).history.length > 0,
	);
	const strangers = others.length - talked.length;
	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				aboutHuman(agent, 2),
				GOOD_TEAM,
				[
					ask === 1
						? "Matching is over: this is the deadline. Your human is in the group below, and every member is now asked whether they're confident in it."
						: "Someone dropped out of your human's group at the deadline, so it changed. Every remaining member is asked once more whether they're confident in it as it is now.",
					"The group can't grow any more: judge it as it is. Answer confident true to stay: your human joins the team, and names are shared among everyone who stays. Answer false to drop out: your human ends with no team this time.",
					"Stay unless the group is clearly wrong for your human: a project they wouldn't want, logistics that can't work, or their skills going unused. A missing role or a small team is a cost to weigh, not a reason on its own.",
					...(strangers > 0
						? [
								`You haven't talked with ${strangers === 1 ? "one member" : `${strangers} members`}; nothing about them is known yet.`,
							]
						: []),
					"Only your answer is used; your rationale is private.",
					CITE_FACTS,
				].join("\n"),
				...talked.map((id) => factsText(fitFacts(agent, id))),
			].join("\n\n"),
		},
		{
			role: "user",
			content: `Your group: ${JSON.stringify({
				project: team.project,
				size: team.members.length,
				rolesStillNeeded: needed,
			})}`,
		},
	];
}

// Asks every member of every tentative group whether they're confident in it, drops whoever isn't, asks the
// rest once more where anyone dropped, then commits what's left and has its members swap names. Returns a new
// world; the one passed in is unchanged.
export async function runLock(
	client: LlmClient,
	world: World,
	{ revealNames = true, onExchange, onEvent }: LockOptions = {},
): Promise<LockResult> {
	const { bus } = world;
	const agents = { ...world.agents };
	const emit = (event: RunEvent) => onEvent?.(event);
	const llmOptions = {
		onExchange: (exchange: Exchange) => {
			onExchange?.(exchange);
			emit(exchangeEvent(exchange));
		},
	};
	const unsubscribe = bus.subscribe((event) => emit({ type: "bus", event }));
	try {
		const dropped: string[] = [];
		let teams = world.teams.filter((t) => t.status === "tentative");
		const settled = world.teams.filter((t) => t.status !== "tentative");
		teams = await askAll(teams, 1, dropped);
		const changed = teams.filter((t) =>
			world.teams
				.find((before) => before.id === t.id)!
				.members.some((m) => dropped.includes(m)),
		);
		const unchanged = teams.filter((t) => !changed.includes(t));
		const reasked = await askAll(changed, 2, dropped);
		const final = [...unchanged, ...reasked].map((t): Team => ({
			...t,
			status: "committed",
		}));
		for (const team of final) {
			emit({ type: "team", team });
			if (revealNames) {
				for (const a of team.members) {
					for (const b of team.members) {
						if (a !== b) {
							shareName(a, b);
						}
					}
				}
			}
		}
		deliver();
		return {
			world: { ...world, agents, teams: [...settled, ...final] },
			dropped,
		};
	} finally {
		unsubscribe();
	}

	// Asks every member of `teams` at once; whoever isn't confident drops out and tells the rest. Returns the
	// teams that still have two or more members.
	async function askAll(
		teams: readonly Team[],
		ask: 1 | 2,
		dropped: string[],
	): Promise<Team[]> {
		const answers = await Promise.all(
			teams.flatMap((team) =>
				team.members.map(async (member) => ({
					team,
					member,
					...(await confidence(member, team, ask)),
				})),
			),
		);
		const out = new Set<string>();
		for (const answer of answers) {
			emit({
				type: "lock",
				agent: answer.member,
				team: answer.team.id,
				ask,
				confident: answer.confident,
				...(answer.rationale !== undefined && {
					rationale: answer.rationale,
				}),
				fellBack: answer.fellBack,
			});
			if (!answer.confident) {
				out.add(answer.member);
				dropped.push(answer.member);
				for (const teammate of answer.team.members) {
					if (teammate !== answer.member) {
						const leave: Leave = {
							kind: "leave",
							from: answer.member,
							to: teammate,
							team: answer.team.id,
						};
						bus.send(answer.member, leave);
						agents[answer.member] = recordMessage(
							agents[answer.member]!,
							teammate,
							leave,
						);
					}
				}
			}
		}
		return teams.flatMap((team) => {
			const members = team.members.filter((m) => !out.has(m));
			return members.length >= 2 ? [{ ...team, members }] : [];
		});
	}

	// Whether `member` is confident in `team`. If no valid answer comes back, it drops out: names can't be
	// unshared, so not confirming is the safe default.
	async function confidence(member: string, team: Team, ask: 1 | 2) {
		try {
			const { data } = await brainOf(client, member).chatJson(
				lockMessages(
					agents[member]!,
					team,
					stillNeeded(
						{ ...world, agents, teams: [team] },
						team.members[0]!,
					),
					ask,
				),
				AgentConfidence,
				llmOptions,
			);
			return {
				confident: data.confident,
				rationale: data.rationale as string | undefined,
				fellBack: false,
			};
		} catch (error) {
			if (!(error instanceof StructuredOutputError)) {
				throw error;
			}
			return { confident: false, rationale: undefined, fellBack: true };
		}
	}

	// Hands every waiting message to its recipient, who records it and learns any name shared.
	function deliver() {
		for (const receiver of Object.keys(agents).sort()) {
			for (const message of bus.receive(receiver)) {
				agents[receiver] = recordMessage(
					agents[receiver]!,
					message.from,
					message,
				);
				if ("kind" in message && message.kind === "share") {
					agents[receiver] = learn(
						agents[receiver]!,
						message.from,
						message.shared,
					);
				}
			}
		}
	}

	// Opens level 3 from `from` to `to` and sends `from`'s name: a share built from the profile and checked
	// by the gate anyway, as a second line of defense.
	function shareName(from: string, to: string) {
		const agent = agents[from]!;
		const level = contactOf(agent, to).level;
		if (level < 3) {
			emit({ type: "level", agent: from, other: to, from: level, to: 3 });
			agents[from] = raiseLevel(agent, to, 3);
		}
		const shared: Partial<Profile> = { name: agent.profile.name };
		if (
			checkDisclosure(agent.profile, 3, { texts: {}, shared }).length > 0
		) {
			throw new Error(`name share from ${from} broke the rules`);
		}
		const share: Share = { kind: "share", from, to, level: 3, shared };
		bus.send(from, share);
		agents[from] = recordRevealed(
			recordMessage(agents[from]!, to, share),
			to,
			["name"],
		);
	}
}
