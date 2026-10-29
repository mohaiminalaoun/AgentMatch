import { z } from "zod";
import { contactOf, type AgentState } from "./agent.js";
import type { LlmClient } from "./client.js";
import { isOpen } from "./commitment.js";
import { exchangeEvent, type RunEvent } from "./events.js";
import {
	StructuredOutputError,
	type ChatOptions,
	type Exchange,
	type Message,
} from "./llm.js";
import { JOIN_PREFIX, type Proposal } from "./proposal.js";
import { publicPitch, type World } from "./round.js";

// One agent's listing on the public board: only what it shows at level 0, plus how many committed teams
// its human has left, if any.
export type BoardEntry = {
	id: string;
	pitch: string;
	rolesNeeded: string[];
	leftTeams?: number;
};

// What the model returns: private reasoning, then the ids it wants to approach, best first.
export const AgentPicks = z.object({
	rationale: z.string().min(1),
	approach: z.array(z.string()),
});

export type AgentPicks = z.infer<typeof AgentPicks>;

// One agent's choice, as kept after checking and trimming.
export type Pick = {
	agent: string;
	approach: string[];
	// Private to the agent's human, like every rationale; never sent.
	rationale: string | undefined;
	fellBack: boolean;
};

export type DiscoveryOptions = {
	// The most agents one agent may approach in a round.
	perAgent?: number;
	// Used in proposal ids, so rounds don't reuse them.
	round?: number;
	// Agents not asked this round, for example because nothing they could see has changed since they
	// last picked nobody. They make no model call and approach nobody.
	skip?: ReadonlySet<string>;
	onExchange?: ChatOptions["onExchange"];
	onEvent?: (event: RunEvent) => void;
};

const DEFAULT_PER_AGENT = 3;

// The public board: every agent with a project idea, showing only its level-0 pitch and roles needed.
// People already on a team are off it, except owners whose team still has places.
export function buildBoard(world: World): BoardEntry[] {
	return Object.values(world.agents)
		.filter((agent) => isOpen(world, agent.id))
		.flatMap((agent) => {
			const terms = publicPitch(agent);
			return terms
				? [
						{
							id: agent.id,
							...terms,
							...(agent.leftTeams > 0 && {
								leftTeams: agent.leftTeams,
							}),
						},
					]
				: [];
		})
		.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// Someone looking to join, as the board lists them: only their id (and how many committed teams they've
// left, if any). They have no project to pitch, and nothing else about them is public.
export type Seeker = { id: string; leftTeams?: number };

// Everyone still open with no project idea, so owners can approach them.
export function buildSeekers(world: World): Seeker[] {
	return Object.values(world.agents)
		.filter((agent) => isOpen(world, agent.id) && !publicPitch(agent))
		.map((agent) => ({
			id: agent.id,
			...(agent.leftTeams > 0 && { leftTeams: agent.leftTeams }),
		}))
		.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// The prompt asking `agent` whom to approach: its own profile, plus the board and nothing else
// about anyone. Being on the board reveals only what's already public. People looking to join are shown
// only to agents with a project to pitch them.
export function discoveryMessages(
	agent: AgentState,
	board: readonly BoardEntry[],
	perAgent: number,
	seekers: readonly Seeker[] = [],
): Message[] {
	const others = board.filter((entry) => entry.id !== agent.id);
	const joiners = publicPitch(agent)
		? seekers.filter((seeker) => seeker.id !== agent.id)
		: [];
	const talking = Object.keys(agent.contacts).filter(
		(id) => contactOf(agent, id).history.length > 0,
	);
	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.",
				`Your human's full profile (private; for your judgment only):\n${JSON.stringify(agent.profile, null, 2)}`,
				[
					`Below is the public board: other people's project pitches and the roles they need. Choose up to ${perAgent} you most want to approach, best first, by their id.`,
					"Approach where your human could fill a role a project needs, or the other person could fill one your human's project needs, and the project is something your human would plausibly enjoy. Shared interests help, but a strong role fit counts even when interests overlap only loosely.",
					...(joiners.length > 0
						? [
								"People looking to join have no project of their own, and only their ids are public. You may approach them with your human's project.",
							]
						: []),
					...([...others, ...joiners].some((entry) => entry.leftTeams)
						? [
								"leftTeams on an entry is how many committed teams that person has left before; weigh their reliability.",
							]
						: []),
					"Be selective: an empty list is fine if nothing fits. Your rationale is private.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`Public board: ${JSON.stringify(others)}`,
				...(joiners.length > 0
					? [`Looking to join: ${JSON.stringify(joiners)}`]
					: []),
				`Already talking with (don't pick): ${talking.length > 0 ? talking.join(", ") : "nobody"}`,
			].join("\n"),
		},
	];
}

// Every agent still open looks at the board and picks whom to approach, all at once; agents with a project
// may also pick people looking to join. Picks are checked (on the board,
// not itself), trimmed to `perAgent`, and turned into proposals: an agent with a project idea pitches it;
// one without asks to join the target's project. A pair already talking is skipped, and if two agents pick
// each other, only one proposal is made, from whichever comes first in id order.
export async function discover(
	client: LlmClient,
	world: World,
	{
		perAgent = DEFAULT_PER_AGENT,
		round = 1,
		skip = new Set(),
		onExchange,
		onEvent,
	}: DiscoveryOptions = {},
): Promise<{ proposals: Proposal[]; picks: Pick[] }> {
	const board = buildBoard(world);
	const listed = new Map(board.map((entry) => [entry.id, entry]));
	const seekers = buildSeekers(world);
	const seeking = new Set(seekers.map((seeker) => seeker.id));
	// Someone on a team is done looking, unless they own it and it has places left.
	const agents = Object.values(world.agents)
		.filter((agent) => isOpen(world, agent.id) && !skip.has(agent.id))
		.sort((a, b) => (a.id < b.id ? -1 : 1));
	const llmOptions = {
		onExchange: (exchange: Exchange) => {
			onExchange?.(exchange);
			onEvent?.(exchangeEvent(exchange));
		},
	};

	const picks = await Promise.all(
		agents.map(async (agent): Promise<Pick> => {
			try {
				const { data } = await client.chatJson(
					discoveryMessages(agent, board, perAgent, seekers),
					AgentPicks,
					{
						...llmOptions,
						check: ({ approach }) =>
							approach.flatMap((id) =>
								id === agent.id
									? [
											`approach: "${id}" is you; pick other people`,
										]
									: listed.has(id) ||
										  (seeking.has(id) &&
												publicPitch(agent))
										? []
										: seeking.has(id)
											? [
													`approach: "${id}" is looking to join too; with no project of your own, pick from the project board`,
												]
											: [
													`approach: "${id}" isn't on the board; use ids from the board only`,
												],
							),
					},
				);
				const approach = [...new Set(data.approach)]
					.filter((id) => contactOf(agent, id).history.length === 0)
					.slice(0, perAgent);
				return {
					agent: agent.id,
					approach,
					rationale: data.rationale,
					fellBack: false,
				};
			} catch (error) {
				if (!(error instanceof StructuredOutputError)) {
					throw error;
				}
				// No valid choice came back: approach nobody this round.
				return {
					agent: agent.id,
					approach: [],
					rationale: undefined,
					fellBack: true,
				};
			}
		}),
	);

	const proposals: Proposal[] = [];
	const paired = new Set<string>();
	for (const pick of picks) {
		onEvent?.({ type: "discovery", ...pick });
		const agent = world.agents[pick.agent]!;
		for (const to of pick.approach) {
			const pair = [pick.agent, to].sort().join("|");
			if (paired.has(pair)) {
				continue;
			}
			paired.add(pair);
			const id = `r${round}-${pick.agent}-${to}`;
			const own = publicPitch(agent);
			const target = listed.get(to)!;
			// The proposer's own record travels with every proposal, set here rather than by any model.
			const record =
				agent.leftTeams > 0 ? { leftTeams: agent.leftTeams } : {};
			proposals.push(
				own
					? { id, from: pick.agent, to, ...own, ...record }
					: {
							// Nothing of its own to pitch: ask to join theirs, revealing nothing about itself.
							id,
							from: pick.agent,
							to,
							pitch: `${JOIN_PREFIX}${target.pitch}`.slice(
								0,
								280,
							),
							rolesNeeded: target.rolesNeeded,
							...record,
						},
			);
		}
	}
	return { proposals, picks };
}
