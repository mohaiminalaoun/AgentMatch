import { contactOf, type AgentMessage } from "./agent.js";
import type { LlmClient } from "./client.js";
import { runCommitment } from "./commitment.js";
import { discover } from "./discovery.js";
import type { RunEvent } from "./events.js";
import type { TokenUsage } from "./llm.js";
import { writeListings } from "./listing.js";
import { CORE_ROLES, type Profile } from "./profile.js";
import { continued, createWorld, runRound, type World } from "./round.js";
import type { Team } from "./team.js";

export type SimulationOptions = {
	rounds?: number;
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
	// How many listings ask for each role beyond the core four.
	nonCoreRoles: Record<string, number>;
	pairs: PairOutcome[];
	teams: Team[];
	// Members who left a team after it grew.
	departures: number;
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
// Everything shares one client and one bus.
export async function runSimulation(
	client: LlmClient,
	profiles: readonly Profile[],
	{
		rounds = 2,
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

	for (let round = 1; round <= rounds; round++) {
		const { proposals, picks } = await discover(client, world, {
			round,
			...(perAgent && { perAgent }),
			...(onEvent && { onEvent }),
		});
		const picked = picks.reduce((sum, p) => sum + p.approach.length, 0);
		onPhase?.(
			`round ${round}: ${picked} picks → ${proposals.length} proposals`,
		);
		const result = await runRound(world, client, proposals, {
			...(maxTicks && { maxTicks }),
			...(onEvent && { onEvent }),
		});
		world = result.world;
		onPhase?.(
			`round ${round}: conversations finished in ${result.ticks} ticks${result.quiet ? "" : " (stopped at the tick limit)"}`,
		);
		const commitment = await runCommitment(client, world, {
			...(onEvent && { onEvent }),
		});
		world = commitment.world;
		onPhase?.(
			commitment.skipped
				? `round ${round}: no offers (mail still waiting at the tick limit)`
				: `round ${round}: ${commitment.offers} offers → ${commitment.commits} commits in ${commitment.passes} pass${commitment.passes === 1 ? "" : "es"}${commitment.departures > 0 ? ` · ${commitment.departures} left` : ""} · teams: ${world.teams.length}`,
		);
	}
	return world;
}

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
			const match = /^r(\d+)-/.exec(event.event.message.id);
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
		}
		if (
			(event.type === "decision" ||
				event.type === "listing" ||
				event.type === "interest" ||
				event.type === "discovery" ||
				event.type === "offers" ||
				event.type === "commitment" ||
				event.type === "recheck") &&
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
		nonCoreRoles,
		pairs,
		teams: world.teams,
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
