import {
	contactOf,
	createAgent,
	learn,
	raiseLevel,
	recordMessage,
	recordRevealed,
	type AgentMessage,
	type AgentState,
} from "./agent.js";
import { createBus, type Bus } from "./bus.js";
import type { LlmClient } from "./client.js";
import { decideOnProposal, type DecisionResult } from "./decision.js";
import {
	FIELD_LEVELS,
	type DisclosureLevel,
	type ProfileField,
} from "./disclosure.js";
import { checkDisclosure, fieldsMentioned } from "./gate.js";
import {
	checkInterest,
	considerRevision,
	type InterestResult,
} from "./interest.js";
import { exchangeEvent, type RunEvent } from "./events.js";
import { getHunch, type Hunch } from "./hunch.js";
import type { ChatOptions, Exchange } from "./llm.js";
import { CORE_ROLES, type Profile } from "./profile.js";
import {
	toResponse,
	type Interest,
	type Proposal,
	type ProposalResponse,
	type Revision,
	type RevisionAnswer,
	type Share,
	type Terms,
} from "./proposal.js";
import type { Note } from "./notes.js";
import type { Team } from "./team.js";

// Everything a run needs: every agent's state, the one bus they all talk through, and the teams formed so far.
// Agent states and teams are plain data replaced as the run goes; the bus keeps its own inboxes and event count.
export type World = {
	agents: Record<string, AgentState>;
	bus: Bus;
	teams: Team[];
};

// One decision an agent's model made, for printing and checking. The rationale is private
// to the deciding agent's human and appears only here and in their own logs, never on the bus.
export type RoundEntry = {
	proposal: Proposal;
	result: DecisionResult;
	response: ProposalResponse;
};

// One interest check: after learning `otherId`'s share at `level`, whether `agent` kept going.
// The rationale is private to the agent's human, like a decision's.
export type InterestEntry = {
	agent: string;
	otherId: string;
	level: DisclosureLevel;
	result: InterestResult;
};

export type RoundOptions = {
	// Stop after this many ticks even if messages are still waiting, so counters can't loop forever.
	maxTicks?: number;
	// The highest level two agents can open. A mutual continue at this level means they're ready to commit.
	maxLevel?: DisclosureLevel;
	// Called after every successful model call, e.g. to log the conversation.
	onExchange?: ChatOptions["onExchange"];
	// Called after each tick with the world so far, e.g. to print levels as they change.
	onTick?: (tick: number, world: World) => void;
	// Called with every event of the run, in order: for logging, live output, and later the UI.
	onEvent?: (event: RunEvent) => void;
};

export type RoundResult = {
	world: World;
	report: RoundEntry[];
	interests: InterestEntry[];
	ticks: number;
	// True if every inbox was empty at the end; false if it stopped at maxTicks with mail waiting.
	quiet: boolean;
};

const DEFAULT_MAX_TICKS = 12;
const DEFAULT_MAX_LEVEL = 2;

// A world with one agent per profile, all on a fresh bus. `notes` gives some humans private notes, by id.
export function createWorld(
	profiles: readonly Profile[],
	notes: Record<string, readonly Note[]> = {},
): World {
	return {
		agents: Object.fromEntries(
			profiles.map((p) => [p.id, createAgent(p, notes[p.id])]),
		),
		bus: createBus(profiles.map((p) => p.id)),
		teams: [],
	};
}

// What `agent` shows the world at level 0: its listing if its model has written one; otherwise its first
// project idea as the pitch and the core roles it has no skill in as the roles needed. Undefined if it
// has no project idea, since then it has nothing public to pitch.
export function publicPitch(agent: AgentState): Terms | undefined {
	if (agent.listing) {
		return agent.listing;
	}
	const idea = agent.profile.projectIdeas[0];
	if (!idea) {
		return undefined;
	}
	const skills = new Set(agent.profile.skills.map((s) => s.name));
	const missing = CORE_ROLES.filter((role) => !skills.has(role));
	return {
		pitch: `${idea.title}: ${idea.description}`.slice(0, 280),
		// Someone who already covers every core role still needs teammates, just not a particular one.
		rolesNeeded: missing.length > 0 ? missing : ["any"],
	};
}

// A proposal from `proposer` to `to` carrying only its public pitch; undefined if it has none.
export function proposalFrom(
	proposer: AgentState,
	to: string,
	id: string,
): Proposal | undefined {
	const terms = publicPitch(proposer);
	return terms && { id, from: proposer.id, to, ...terms };
}

// Sends `proposals`, then runs ticks until no mail is waiting (or maxTicks). In each tick every agent
// handles its whole inbox, with all model calls at once:
// - a proposal or counter is decided on (accept, counter, or decline);
// - an accept means mutual interest: level 1 opens and both sides share that level's fields;
// - a share is learned, then the agent checks whether to keep going and sends continue or withdraw, and with
//   a continue may propose a reshaped version of the project (a revision), which the other side adopts or keeps;
// - once both sides have continued at a level, the next one opens, up to maxLevel.
// Replies go out in inbox order, which doesn't depend on which model call finished first.
// Returns a new world; the one passed in is unchanged.
export async function runRound(
	world: World,
	client: LlmClient,
	proposals: readonly Proposal[],
	{
		maxTicks = DEFAULT_MAX_TICKS,
		maxLevel = DEFAULT_MAX_LEVEL,
		onTick,
		onExchange,
		onEvent,
	}: RoundOptions = {},
): Promise<RoundResult> {
	const { bus } = world;
	const agents = { ...world.agents };
	const report: RoundEntry[] = [];
	const interests: InterestEntry[] = [];
	const emit = (event: RunEvent) => onEvent?.(event);
	// A private hunch, as an event for the human's own log: its rationale may draw on "never" notes.
	const emitHunch = (agent: string, other: string, hunch?: Hunch) =>
		hunch &&
		emit({
			type: "hunch",
			agent,
			other,
			steer: hunch.steer,
			riskArea: hunch.riskArea,
			rationale: hunch.rationale,
			fellBack: hunch.fellBack,
		});
	const llmOptions = {
		onExchange: (exchange: Exchange) => {
			onExchange?.(exchange);
			emit(exchangeEvent(exchange));
		},
	};

	emit({
		type: "round",
		time: new Date().toISOString(),
		model: client.model,
		agents: Object.keys(agents).sort(),
	});
	// The bus's own events join the stream, so a caller gets one ordered record of everything.
	const unsubscribe = bus.subscribe((event) => emit({ type: "bus", event }));
	try {
		return await play();
	} finally {
		unsubscribe();
	}

	// The round itself; a separate function so the bus subscription above is always removed.
	async function play(): Promise<RoundResult> {
		// Sends `message` from `from` and records it, and what it revealed, in the sender's state.
		const send = (
			from: string,
			message: AgentMessage,
			revealed: ProfileField[],
		) => {
			bus.send(from, message);
			agents[from] = recordRevealed(
				recordMessage(agentOf(agents, from), message.to, message),
				message.to,
				revealed,
			);
		};

		// Both sides wanted the same thing, so `id` opens `level` with `otherId` and shares that level's fields.
		const openLevel = (
			id: string,
			otherId: string,
			level: DisclosureLevel,
		) => {
			const agent = agentOf(agents, id);
			if (
				level === 0 ||
				level > maxLevel ||
				contactOf(agent, otherId).level >= level
			) {
				return;
			}
			emit({
				type: "level",
				agent: id,
				other: otherId,
				from: contactOf(agent, otherId).level,
				to: level,
			});
			agents[id] = raiseLevel(agent, otherId, level);
			const fields = (Object.keys(FIELD_LEVELS) as ProfileField[]).filter(
				(field) => FIELD_LEVELS[field] === level,
			);
			const shared = Object.fromEntries(
				fields.map((field) => [field, agent.profile[field]]),
			) as Partial<Profile>;
			// Built from the profile, so this always passes; checked anyway, as a second line of defense.
			const violations = checkDisclosure(agent.profile, level, {
				texts: {},
				shared,
			});
			if (violations.length > 0) {
				throw new Error(
					`share from ${id} broke the rules: ${JSON.stringify(violations)}`,
				);
			}
			const share: Share = {
				kind: "share",
				from: id,
				to: otherId,
				level,
				shared,
			};
			send(id, share, fields);
		};

		// If both `id` and `otherId` have said continue at `level`, opens the next one.
		const openNextIfMutual = (
			id: string,
			otherId: string,
			level: DisclosureLevel,
		) => {
			const agent = agentOf(agents, id);
			if (
				continued(agent, id, otherId, level) &&
				continued(agent, otherId, id, level)
			) {
				openLevel(id, otherId, (level + 1) as DisclosureLevel);
			}
		};

		for (const proposal of [...proposals].sort((a, b) =>
			compare(a.id, b.id),
		)) {
			const sender = agentOf(agents, proposal.from);
			send(
				proposal.from,
				proposal,
				// Its roles are ones the proposer lacks, by construction, so only the pitch can reveal anything.
				fieldsMentioned(sender.profile, proposal.pitch),
			);
		}

		let ticks = 0;
		while (bus.waiting() > 0 && ticks < maxTicks) {
			ticks++;
			emit({ type: "tick", n: ticks });
			const incoming = Object.keys(agents)
				.sort()
				.flatMap((receiver) =>
					bus
						.receive(receiver)
						.map((message) => ({ receiver, message })),
				);

			// Decisions use each agent's state from before this tick's mail, so the message being decided on
			// isn't listed twice in the prompt. Interest checks use the state after learning the share,
			// since judging what was just shared is the point.
			const before = { ...agents };
			for (const { receiver, message } of incoming) {
				agents[receiver] = recordMessage(
					agentOf(agents, receiver),
					message.from,
					message,
				);
				if (isShare(message)) {
					agents[receiver] = learn(
						agentOf(agents, receiver),
						message.from,
						message.shared,
					);
				}
			}
			const toDecide = incoming.flatMap(({ receiver, message }) => {
				const proposal = asProposal(message);
				return proposal ? [{ receiver, proposal }] : [];
			});
			const toCheck = incoming.flatMap(({ receiver, message }) =>
				isShare(message) ? [{ receiver, share: message }] : [],
			);
			const toConsider = incoming.flatMap(({ receiver, message }) =>
				isRevision(message) ? [{ receiver, revision: message }] : [],
			);
			const [results, checks, adoptions] = await Promise.all([
				// An agent with "never" notes gets a private hunch first, which steers the call after it.
				Promise.all(
					toDecide.map(async ({ receiver, proposal }) => {
						const agent = agentOf(before, receiver);
						const hunch = await getHunch(
							client,
							agent,
							proposal.from,
							`They propose: ${JSON.stringify({ pitch: proposal.pitch, rolesNeeded: proposal.rolesNeeded })}. Your agent will accept, counter, or decline.`,
							llmOptions,
						);
						return decideOnProposal(
							client,
							agent,
							proposal,
							llmOptions,
							hunch,
						);
					}),
				),
				Promise.all(
					toCheck.map(async ({ receiver, share }) => {
						const agent = agentOf(agents, receiver);
						const hunch = await getHunch(
							client,
							agent,
							share.from,
							`They just shared their level-${share.level} details. Your agent will decide whether to keep going toward a team.`,
							llmOptions,
						);
						return checkInterest(
							client,
							agent,
							share.from,
							share.level,
							llmOptions,
							hunch,
						);
					}),
				),
				Promise.all(
					toConsider.map(({ receiver, revision }) =>
						considerRevision(
							client,
							agentOf(agents, receiver),
							revision,
							llmOptions,
						),
					),
				),
			]);

			// Act in inbox order, which is fixed; Promise.all kept the results in that same order.
			let decided = 0;
			let checked = 0;
			let considered = 0;
			for (const { receiver, message } of incoming) {
				const proposal = asProposal(message);
				if (proposal) {
					const result = results[decided++]!;
					emitHunch(receiver, proposal.from, result.hunch);
					const response = toResponse(proposal, result.decision);
					const pitch =
						"pitch" in response
							? `${response.pitch} ${response.rolesNeeded.join(", ")}`
							: "";
					send(
						receiver,
						response,
						fieldsMentioned(
							agentOf(agents, receiver).profile,
							pitch,
						),
					);
					report.push({ proposal, result, response });
					emit({
						type: "decision",
						agent: receiver,
						proposalId: proposal.id,
						decision: result.decision,
						rationale: result.rationale,
						gateBlocks: result.gateBlocks,
						fellBack: result.fellBack,
					});
					if (response.decision === "accept") {
						openLevel(receiver, proposal.from, 1);
					}
				} else if (
					"decision" in message &&
					message.decision === "accept"
				) {
					openLevel(receiver, message.from, 1);
				} else if (isShare(message)) {
					const result = checks[checked++]!;
					emitHunch(receiver, message.from, result.hunch);
					const interest: Interest = {
						kind: "interest",
						from: receiver,
						to: message.from,
						level: message.level,
						interest: result.interest,
					};
					send(receiver, interest, []);
					interests.push({
						agent: receiver,
						otherId: message.from,
						level: message.level,
						result,
					});
					emit({
						type: "interest",
						agent: receiver,
						other: message.from,
						level: message.level,
						interest: result.interest,
						...(result.revision && { revision: result.revision }),
						gateBlocks: result.gateBlocks,
						rationale: result.rationale,
						fellBack: result.fellBack,
					});
					// A reshaped version of the project goes right after the continue, already gate-checked.
					if (result.interest === "continue" && result.revision) {
						const revision: Revision = {
							kind: "revision",
							from: receiver,
							to: message.from,
							level: message.level,
							...result.revision,
						};
						send(
							receiver,
							revision,
							fieldsMentioned(
								agentOf(agents, receiver).profile,
								`${revision.pitch} ${revision.rolesNeeded.join(", ")}`,
							),
						);
					}
					openNextIfMutual(receiver, message.from, message.level);
				} else if (
					isInterest(message) &&
					message.interest === "continue"
				) {
					openNextIfMutual(receiver, message.from, message.level);
				} else if (isRevision(message)) {
					const result = adoptions[considered++]!;
					const answer: RevisionAnswer = {
						kind: "revisionAnswer",
						from: receiver,
						to: message.from,
						adopt: result.adopt,
					};
					send(receiver, answer, []);
					emit({
						type: "revisionAnswer",
						agent: receiver,
						other: message.from,
						adopt: result.adopt,
						rationale: result.rationale,
						fellBack: result.fellBack,
					});
				}
			}

			onTick?.(ticks, { ...world, agents: { ...agents } });
		}

		return {
			world: { ...world, agents },
			report,
			interests,
			ticks,
			quiet: bus.waiting() === 0,
		};
	}
}

// What `message` asks its receiver to decide on: a proposal as is, or a counter's terms as a new
// proposal back to whoever countered. Undefined for anything that needs no decision.
function asProposal(message: AgentMessage): Proposal | undefined {
	if ("kind" in message) {
		return undefined;
	}
	if (!("decision" in message)) {
		return message;
	}
	if (message.decision === "counter") {
		return {
			id: `${message.proposalId}.c`,
			from: message.from,
			to: message.to,
			pitch: message.pitch,
			rolesNeeded: message.rolesNeeded,
		};
	}
	return undefined;
}

// Whether `agent`'s conversation history shows `by` saying continue to `to` at `level`.
export function continued(
	agent: AgentState,
	by: string,
	to: string,
	level: DisclosureLevel,
): boolean {
	const other = agent.id === by ? to : by;
	return contactOf(agent, other).history.some(
		(m) =>
			isInterest(m) &&
			m.from === by &&
			m.level === level &&
			m.interest === "continue",
	);
}

// Whether `message` is a share.
function isShare(message: AgentMessage): message is Share {
	return "kind" in message && message.kind === "share";
}

// Whether `message` is a revision.
function isRevision(message: AgentMessage): message is Revision {
	return "kind" in message && message.kind === "revision";
}

// Whether `message` is an interest.
function isInterest(message: AgentMessage): message is Interest {
	return "kind" in message && message.kind === "interest";
}

// Orders two ids, for sorting.
function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

// The agent with `id`, or an error naming it; a missing agent is a bug in how the run was set up.
function agentOf(agents: Record<string, AgentState>, id: string): AgentState {
	const agent = agents[id];
	if (!agent) {
		throw new Error(`no agent ${id} in this world`);
	}
	return agent;
}
