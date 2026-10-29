import { contactOf, type AgentMessage } from "./agent.js";
import type { LlmClient } from "./client.js";
import { runCommitment } from "./commitment.js";
import {
	brainstorm,
	buildBoard,
	buildSeekers,
	discover,
	leftovers,
} from "./discovery.js";
import type { RunEvent } from "./events.js";
import type { TokenUsage } from "./llm.js";
import { writeListings } from "./listing.js";
import { CORE_ROLES, type Profile } from "./profile.js";
import {
	continued,
	createWorld,
	publicPitch,
	runRound,
	type World,
} from "./round.js";
import type { Team } from "./team.js";

export type SimulationOptions = {
	// The most rounds to run; the run stops sooner once a round changes nothing.
	maxRounds?: number;
	// Whether people left without a team get a brainstorm phase at the end (default true).
	brainstorm?: boolean;
	// The most agents one agent may approach per round.
	perAgent?: number;
	maxTicks?: number;
	onEvent?: (event: RunEvent) => void;
	// Called with a short progress line as each phase finishes, for live output.
	onPhase?: (line: string) => void;
};

// One pair of agents that talked, as both sides see it at the end.
export type PairOutcome = {
	pair: [string, string];
	// The level both sides reached: the lower of their two levels.
	level: number;
	// Both continued at level 2: ready to commit.
	ready: boolean;
	// Someone declined or withdrew.
	ended: boolean;
};

export type SimulationSummary = {
	agents: number;
	rounds: {
		round: number;
		picks: number;
		proposals: number;
		offers: number;
		commits: number;
	}[];
	listings: number;
	// Agents with no project idea, listed on the board as looking to join.
	seekers: number;
	// How many listings ask for each role beyond the core four.
	nonCoreRoles: Record<string, number>;
	pairs: PairOutcome[];
	teams: Team[];
	// For each team, the version of the project it builds and whether that differs from the owner's public
	// listing, the roles that version asks for split by whether a member fills them (from members' real
	// skills), and whether it's smaller than some member's minimum team size.
	teamChecks: {
		team: string;
		project: string;
		reshaped: boolean;
		covered: string[];
		missing: string[];
		belowMinimum: boolean;
	}[];
	// Members who left a team after it grew.
	departures: number;
	// How the run ended, if it did.
	stopped: { rounds: number; reason: "stable" | "limit" } | undefined;
	// The brainstorm phase, if there was one: how many people were still without a team when it began, and how
	// many new teams formed during it.
	brainstorm: { people: number; teams: number } | undefined;
	// Agents on no team at the end.
	unplaced: string[];
	// Agents nobody sent a proposal to.
	neverApproached: string[];
	// Agents that took part in no conversation at all.
	noConversation: string[];
	gateBlocks: number;
	fallbacks: number;
	calls: number;
	// Every model call's usage added up, including hidden reasoning and cached input where reported.
	usage: TokenUsage;
};

// The whole system: every agent writes its board listing once, then each round everyone still open picks whom
// to approach, all the resulting conversations play out at once, and ready pairs become committed teams.
// Rounds repeat until one changes nothing (no proposals, commits, or departures, and no mail left) or
// `maxRounds` is reached. Then, if at least two people are still without a team, up to BRAINSTORM_ROUNDS
// brainstorm rounds let them meet each other and come up with new projects together. It always ends: a pair that has talked is never approached again, so the untried
// pairs run out. An agent that picked nobody isn't asked again until the board changes.
// Everything shares one client and one bus.
export async function runSimulation(
	client: LlmClient,
	profiles: readonly Profile[],
	{
		maxRounds = DEFAULT_MAX_ROUNDS,
		brainstorm: brainstormAtEnd = true,
		perAgent,
		maxTicks,
		onEvent,
		onPhase,
	}: SimulationOptions = {},
): Promise<World> {
	let world = await writeListings(client, createWorld(profiles), {
		...(onEvent && { onEvent }),
	});
	const listed = Object.values(world.agents).filter((a) => a.listing).length;
	onPhase?.(`listings written: ${listed}`);

	// What the board showed when each agent last picked nobody, so they aren't asked again until it changes.
	let lastBoard: string | undefined;
	let pickedNobody = new Set<string>();
	// Why the normal rounds stopped, once they have; after that, rounds are brainstorm rounds.
	let stopped: "stable" | "limit" | undefined;
	let brainstormRounds = 0;
	for (let round = 1; ; round++) {
		const label = stopped
			? `brainstorm round ${brainstormRounds + 1}`
			: `round ${round}`;
		const board = JSON.stringify([buildBoard(world), buildSeekers(world)]);
		const skip =
			!stopped && board === lastBoard ? pickedNobody : new Set<string>();
		const { proposals, picks } = stopped
			? await brainstorm(client, world, {
					round,
					...(perAgent && { perAgent }),
					...(onEvent && { onEvent }),
				})
			: await discover(client, world, {
					round,
					skip,
					...(perAgent && { perAgent }),
					...(onEvent && { onEvent }),
				});
		lastBoard = board;
		// A fallback is a failed call, not a choice, so that agent is asked again.
		pickedNobody = new Set([
			...skip,
			...picks
				.filter((p) => p.approach.length === 0 && !p.fellBack)
				.map((p) => p.agent),
		]);
		const picked = picks.reduce((sum, p) => sum + p.approach.length, 0);
		onPhase?.(
			`${label}: ${picked} picks → ${proposals.length} proposals${skip.size > 0 ? ` · ${skip.size} not asked (board unchanged)` : ""}`,
		);
		const result = await runRound(world, client, proposals, {
			...(maxTicks && { maxTicks }),
			...(onEvent && { onEvent }),
		});
		world = result.world;
		onPhase?.(
			`${label}: conversations finished in ${result.ticks} ticks${result.quiet ? "" : " (stopped at the tick limit)"}`,
		);
		const commitment = await runCommitment(client, world, {
			...(onEvent && { onEvent }),
		});
		world = commitment.world;
		onPhase?.(
			commitment.skipped
				? `${label}: no offers (mail still waiting at the tick limit)`
				: `${label}: ${commitment.offers} offers → ${commitment.commits} commits in ${commitment.passes} pass${commitment.passes === 1 ? "" : "es"}${commitment.departures > 0 ? ` · ${commitment.departures} left` : ""} · teams: ${world.teams.length}`,
		);

		const stable =
			proposals.length === 0 &&
			result.quiet &&
			!commitment.skipped &&
			commitment.commits === 0 &&
			commitment.departures === 0;
		let done = false;
		if (!stopped) {
			// The normal rounds are over: brainstorm if at least two people are still without a team.
			if (stable || round >= maxRounds) {
				stopped = stable ? "stable" : "limit";
				const left = leftovers(world);
				if (brainstormAtEnd && left.length >= 2) {
					onEvent?.({ type: "brainstorm", agents: left });
					onPhase?.(
						`brainstorm: ${left.length} people left without a team try coming up with projects together`,
					);
				} else {
					done = true;
				}
			}
		} else {
			// A brainstorm round: stop once one changes nothing, at the limit, or when too few are left.
			brainstormRounds++;
			done =
				stable ||
				brainstormRounds >= BRAINSTORM_ROUNDS ||
				leftovers(world).length < 2;
		}
		if (done) {
			onEvent?.({ type: "stopped", rounds: round, reason: stopped! });
			return world;
		}
	}
}

// The most brainstorm rounds at the end of a run; they stop sooner once one changes nothing.
const BRAINSTORM_ROUNDS = 2;

const DEFAULT_MAX_ROUNDS = 6;

// What happened in a simulation, worked out from the final world and its events. Pure: no model calls.
export function summarize(
	world: World,
	events: readonly RunEvent[],
): SimulationSummary {
	const ids = Object.keys(world.agents).sort();

	// Discovery events come in one batch per round, before that round's "round" event.
	// Offers and answers come after their round's "round" event, so they count toward round - 1.
	const rounds: SimulationSummary["rounds"] = [];
	const entry = (n: number) =>
		(rounds[n - 1] ??= {
			round: n,
			picks: 0,
			proposals: 0,
			offers: 0,
			commits: 0,
		});
	let round = 1;
	for (const event of events) {
		if (event.type === "round") {
			round++;
		} else if (event.type === "discovery") {
			entry(round).picks += event.approach.length;
		} else if (
			event.type === "bus" &&
			event.event.type === "sent" &&
			"kind" in event.event.message &&
			(event.event.message.kind === "offer" ||
				event.event.message.kind === "answer")
		) {
			const message = event.event.message;
			if (message.kind === "offer") {
				entry(round - 1).offers++;
			} else if (message.answer === "commit") {
				entry(round - 1).commits++;
			}
		} else if (
			event.type === "bus" &&
			event.event.type === "sent" &&
			!("decision" in event.event.message) &&
			!("kind" in event.event.message)
		) {
			const match = /^[rb](\d+)-/.exec(event.event.message.id);
			entry(match ? Number(match[1]) : round - 1).proposals++;
		}
	}

	const nonCoreRoles: Record<string, number> = {};
	let listings = 0;
	for (const agent of Object.values(world.agents)) {
		if (!agent.listing) {
			continue;
		}
		listings++;
		for (const role of agent.listing.rolesNeeded) {
			if (!(CORE_ROLES as readonly string[]).includes(role)) {
				nonCoreRoles[role] = (nonCoreRoles[role] ?? 0) + 1;
			}
		}
	}

	const pairs: PairOutcome[] = [];
	for (const [i, a] of ids.entries()) {
		for (const b of ids.slice(i + 1)) {
			const ab = contactOf(world.agents[a]!, b);
			const ba = contactOf(world.agents[b]!, a);
			// Teammates who only swapped names never had a conversation.
			if (![...ab.history, ...ba.history].some(isProposal)) {
				continue;
			}
			const ended = [...ab.history, ...ba.history].some(
				(m) =>
					("decision" in m && m.decision === "decline") ||
					("kind" in m &&
						m.kind === "interest" &&
						m.interest === "withdraw"),
			);
			pairs.push({
				pair: [a, b],
				level: Math.min(ab.level, ba.level),
				ready:
					continued(world.agents[a]!, a, b, 2) &&
					continued(world.agents[a]!, b, a, 2),
				ended,
			});
		}
	}

	const approached = new Set<string>();
	for (const agent of Object.values(world.agents)) {
		for (const contact of Object.values(agent.contacts)) {
			for (const m of contact.history) {
				if (isProposal(m)) {
					approached.add(m.to);
				}
			}
		}
	}
	const talked = new Set(pairs.flatMap((p) => p.pair));

	let gateBlocks = 0;
	let fallbacks = 0;
	let calls = 0;
	const usage: TokenUsage = {
		input: 0,
		output: 0,
		total: 0,
		reasoning: 0,
		cached: 0,
	};
	for (const event of events) {
		if (event.type === "decision" || event.type === "listing") {
			gateBlocks += event.gateBlocks;
		} else if (event.type === "interest") {
			gateBlocks += event.gateBlocks ?? 0;
		}
		if (
			(event.type === "decision" ||
				event.type === "listing" ||
				event.type === "interest" ||
				event.type === "discovery" ||
				event.type === "offers" ||
				event.type === "commitment" ||
				event.type === "recheck" ||
				event.type === "revisionAnswer" ||
				event.type === "hunch") &&
			event.fellBack
		) {
			fallbacks++;
		}
		if (event.type === "exchange") {
			calls++;
			usage.input += event.usage?.input ?? 0;
			usage.output += event.usage?.output ?? 0;
			usage.total += event.usage?.total ?? 0;
			usage.reasoning! += event.usage?.reasoning ?? 0;
			usage.cached! += event.usage?.cached ?? 0;
		}
	}

	return {
		agents: ids.length,
		rounds,
		listings,
		seekers: Object.values(world.agents).filter(
			(a) => a.profile.projectIdeas.length === 0,
		).length,
		nonCoreRoles,
		pairs,
		teams: world.teams,
		stopped: stopOf(events),
		brainstorm: brainstormOf(events),
		teamChecks: world.teams.map((team) => {
			const [owner, ...joined] = team.members.map(
				(id) => world.agents[id]!,
			);
			const skills = new Set(
				joined.flatMap((a) => a.profile.skills.map((s) => s.name)),
			);
			const needed = team.rolesNeeded;
			const filled = (role: string) =>
				role === "any" ? joined.length > 0 : skills.has(role);
			return {
				team: team.id,
				project: team.project.description,
				reshaped:
					team.project.description !== publicPitch(owner!)?.pitch,
				covered: needed.filter(filled),
				missing: needed.filter((role) => !filled(role)),
				belowMinimum: team.members.some(
					(id) =>
						team.members.length <
						world.agents[id]!.profile.preferences.minTeamSize,
				),
			};
		}),
		departures: events.filter(
			(e) => e.type === "recheck" && e.decision === "leave",
		).length,
		unplaced: ids.filter(
			(id) => !world.teams.some((t) => t.members.includes(id)),
		),
		neverApproached: ids.filter((id) => !approached.has(id)),
		noConversation: ids.filter((id) => !talked.has(id)),
		gateBlocks,
		fallbacks,
		calls,
		usage,
	};
}

// Whether `message` is a proposal: the only message with neither a decision nor a kind.
function isProposal(message: AgentMessage): boolean {
	return !("decision" in message) && !("kind" in message);
}

// How the run ended, from its last "stopped" event.
function stopOf(events: readonly RunEvent[]): SimulationSummary["stopped"] {
	const stop = events.findLast((e) => e.type === "stopped");
	return stop?.type === "stopped"
		? { rounds: stop.rounds, reason: stop.reason }
		: undefined;
}

// The brainstorm phase, from its event and the teams that first appeared after it.
function brainstormOf(
	events: readonly RunEvent[],
): SimulationSummary["brainstorm"] {
	const start = events.findIndex((e) => e.type === "brainstorm");
	const begin = events[start];
	if (!begin || begin.type !== "brainstorm") {
		return undefined;
	}
	const teamIds = (list: readonly RunEvent[]) =>
		new Set(list.flatMap((e) => (e.type === "team" ? [e.team.id] : [])));
	const before = teamIds(events.slice(0, start));
	const after = [...teamIds(events.slice(start))].filter(
		(id) => !before.has(id),
	);
	return { people: begin.agents.length, teams: after.length };
}
