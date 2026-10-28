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
import {
	decideOnProposal,
	type AgentDecision,
	type DecisionResult,
} from "./decision.js";
import {
	FIELD_LEVELS,
	type DisclosureLevel,
	type ProfileField,
} from "./disclosure.js";
import { checkDisclosure, fieldsMentioned } from "./gate.js";
import type { ChatJsonOptions } from "./llm.js";
import { CORE_ROLES, type Profile } from "./profile.js";
import {
	toResponse,
	type Proposal,
	type ProposalResponse,
	type Share,
} from "./proposal.js";

// Everything a run needs: every agent's state, plus the one bus they all talk through.
// Agent states are plain data replaced as the run goes; the bus keeps its own inboxes and event count.
export type World = {
	agents: Record<string, AgentState>;
	bus: Bus;
};

// One decision an agent's model made, for printing and checking. The rationale is private
// to the deciding agent's human and appears only here and in their own logs, never on the bus.
export type RoundEntry = {
	proposal: Proposal;
	result: DecisionResult;
	response: ProposalResponse;
};

export type RoundOptions = ChatJsonOptions<AgentDecision> & {
	// Stop after this many ticks even if messages are still waiting, so counters can't loop forever.
	maxTicks?: number;
	// Called after each tick with the world so far, e.g. to print levels as they change.
	onTick?: (tick: number, world: World) => void;
};

export type RoundResult = {
	world: World;
	report: RoundEntry[];
	ticks: number;
	// True if every inbox was empty at the end; false if it stopped at maxTicks with mail waiting.
	quiet: boolean;
};

const DEFAULT_MAX_TICKS = 8;

// A world with one agent per profile, all on a fresh bus.
export function createWorld(profiles: readonly Profile[]): World {
	return {
		agents: Object.fromEntries(profiles.map((p) => [p.id, createAgent(p)])),
		bus: createBus(profiles.map((p) => p.id)),
	};
}

// A proposal built from the proposer's public information only: their first project idea as the pitch,
// and the core roles they have no skill in as the roles needed. Undefined if they have no project idea,
// since without one they have nothing public to pitch.
export function proposalFrom(
	proposer: AgentState,
	to: string,
	id: string,
): Proposal | undefined {
	const idea = proposer.profile.projectIdeas[0];
	if (!idea) {
		return undefined;
	}
	const skills = new Set(proposer.profile.skills.map((s) => s.name));
	const missing = CORE_ROLES.filter((role) => !skills.has(role));
	return {
		id,
		from: proposer.id,
		to,
		pitch: `${idea.title}: ${idea.description}`.slice(0, 280),
		// Someone who already covers every core role still needs teammates, just not a particular one.
		rolesNeeded: missing.length > 0 ? missing : ["any"],
	};
}

// Sends `proposals`, then runs ticks until no mail is waiting (or maxTicks). In each tick every agent
// handles its whole inbox: proposals and counters go to its model, all at once; an accept opens level 1
// and both sides share that level's fields; a share is learned. Replies go out in inbox order, which
// doesn't depend on which model call finished first. Returns a new world; the one passed in is unchanged.
export async function runRound(
	world: World,
	client: LlmClient,
	proposals: readonly Proposal[],
	{ maxTicks = DEFAULT_MAX_TICKS, onTick, ...options }: RoundOptions = {},
): Promise<RoundResult> {
	const { bus } = world;
	const agents = { ...world.agents };
	const report: RoundEntry[] = [];

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
	const openLevel = (id: string, otherId: string, level: DisclosureLevel) => {
		const agent = agentOf(agents, id);
		if (level === 0 || contactOf(agent, otherId).level >= level) {
			return;
		}
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

	for (const proposal of [...proposals].sort((a, b) => compare(a.id, b.id))) {
		const sender = agentOf(agents, proposal.from);
		send(
			proposal.from,
			proposal,
			fieldsMentioned(sender.profile, proposal.pitch),
		);
	}

	let ticks = 0;
	while (bus.waiting() > 0 && ticks < maxTicks) {
		ticks++;
		const incoming = Object.keys(agents)
			.sort()
			.flatMap((receiver) =>
				bus.receive(receiver).map((message) => ({ receiver, message })),
			);

		// Proposals and counters need the model; decide on them all at once, with each agent's state
		// from before this tick's mail, so the message being decided on isn't listed twice in the prompt.
		const toDecide = incoming.flatMap(({ receiver, message }) => {
			const proposal = asProposal(message);
			return proposal ? [{ receiver, proposal }] : [];
		});
		const results = await Promise.all(
			toDecide.map(({ receiver, proposal }) =>
				decideOnProposal(
					client,
					agentOf(agents, receiver),
					proposal,
					options,
				),
			),
		);

		for (const { receiver, message } of incoming) {
			agents[receiver] = recordMessage(
				agentOf(agents, receiver),
				message.from,
				message,
			);
			if ("kind" in message) {
				agents[receiver] = learn(
					agentOf(agents, receiver),
					message.from,
					message.shared,
				);
			}
		}

		// Act in inbox order, which is fixed; Promise.all kept the results in that same order.
		let decided = 0;
		for (const { receiver, message } of incoming) {
			const proposal = asProposal(message);
			if (proposal) {
				const result = results[decided++]!;
				const response = toResponse(proposal, result.decision);
				const pitch = "pitch" in response ? response.pitch : "";
				send(
					receiver,
					response,
					fieldsMentioned(agentOf(agents, receiver).profile, pitch),
				);
				report.push({ proposal, result, response });
				if (response.decision === "accept") {
					openLevel(receiver, proposal.from, 1);
				}
			} else if ("decision" in message && message.decision === "accept") {
				openLevel(receiver, message.from, 1);
			}
		}

		onTick?.(ticks, { ...world, agents: { ...agents } });
	}

	return {
		world: { ...world, agents },
		report,
		ticks,
		quiet: bus.waiting() === 0,
	};
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
