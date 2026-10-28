import {
	createAgent,
	recordMessage,
	recordRevealed,
	type AgentState,
} from "./agent.js";
import { createBus, type Bus } from "./bus.js";
import type { LlmClient } from "./client.js";
import {
	decideOnProposal,
	type AgentDecision,
	type DecisionResult,
} from "./decision.js";
import { fieldsMentioned } from "./gate.js";
import type { ChatJsonOptions } from "./llm.js";
import { CORE_ROLES, type Profile } from "./profile.js";
import {
	toResponse,
	type Proposal,
	type ProposalResponse,
} from "./proposal.js";

// Everything a run needs: every agent's state, plus the one bus they all talk through.
// Agent states are plain data replaced each round; the bus keeps its own inboxes and event count.
export type World = {
	agents: Record<string, AgentState>;
	bus: Bus;
};

// What happened to one proposal in a round, for printing and checking. The rationale is private
// to the receiver's human and appears only here and in their own logs, never on the bus.
export type RoundEntry = {
	proposal: Proposal;
	result: DecisionResult;
	response: ProposalResponse;
};

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

// One round: ① proposals are sent, ② every receiver decides at once and replies, ③ proposers read the replies.
// Replies are sent in proposal-id order after all decisions finish, so the bus's order doesn't depend on
// which LLM call returned first. Returns a new world; the one passed in is left unchanged.
export async function runRound(
	world: World,
	client: LlmClient,
	proposals: readonly Proposal[],
	options: ChatJsonOptions<AgentDecision> = {},
): Promise<{ world: World; report: RoundEntry[] }> {
	const { bus } = world;
	const agents = { ...world.agents };
	const byId = (a: { id: string }, b: { id: string }) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

	// ① Propose.
	for (const proposal of [...proposals].sort(byId)) {
		const sender = agentOf(agents, proposal.from);
		bus.send(proposal.from, proposal);
		agents[proposal.from] = recordRevealed(
			recordMessage(sender, proposal.to, proposal),
			proposal.to,
			fieldsMentioned(sender.profile, proposal.pitch),
		);
	}

	// ② Respond: collect every inbox, decide on everything at once, then reply in a fixed order.
	const received = Object.keys(agents)
		.sort()
		.flatMap((id) =>
			bus
				.receive(id)
				.filter((m): m is Proposal => !("decision" in m))
				.map((proposal) => ({ receiver: id, proposal })),
		);
	const decided = await Promise.all(
		received.map(async ({ receiver, proposal }) => ({
			receiver,
			proposal,
			// Decides with the state from before this proposal arrived, so it isn't listed twice in the prompt.
			result: await decideOnProposal(
				client,
				agentOf(agents, receiver),
				proposal,
				options,
			),
		})),
	);
	const report: RoundEntry[] = [];
	for (const { receiver, proposal, result } of decided.sort((a, b) =>
		byId(a.proposal, b.proposal),
	)) {
		const response = toResponse(proposal, result.decision);
		bus.send(receiver, response);
		const pitch = "pitch" in response ? response.pitch : "";
		agents[receiver] = recordRevealed(
			recordMessage(
				recordMessage(
					agentOf(agents, receiver),
					proposal.from,
					proposal,
				),
				proposal.from,
				response,
			),
			proposal.from,
			fieldsMentioned(agentOf(agents, receiver).profile, pitch),
		);
		report.push({ proposal, result, response });
	}

	// ③ Read the replies.
	for (const id of Object.keys(agents).sort()) {
		for (const message of bus.receive(id)) {
			agents[id] = recordMessage(
				agentOf(agents, id),
				message.from,
				message,
			);
		}
	}

	return { world: { ...world, agents }, report };
}

// The agent with `id`, or an error naming it; a missing agent is a bug in how the round was set up.
function agentOf(agents: Record<string, AgentState>, id: string): AgentState {
	const agent = agents[id];
	if (!agent) {
		throw new Error(`no agent ${id} in this world`);
	}
	return agent;
}
