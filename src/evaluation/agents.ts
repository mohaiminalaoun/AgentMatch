// The agents as one more method in the evaluation: the whole simulation on the same generated people as the
// baselines, scored the same way, with leakage measured from what they actually revealed.
import type { LlmClient } from "../engine/client.js";
import type { RunEvent } from "../engine/events.js";
import type { Profile } from "../engine/profile.js";
import type { World } from "../engine/round.js";
import { runSimulation } from "../engine/simulation.js";
import {
	resultFrom,
	summarize,
	type GroupingSummary,
	type MethodResult,
} from "./evaluate.js";
import { measureLeakage } from "./leakage.js";
import { generateProfiles } from "./profiles.js";

export type AgentEvalSettings = {
	seeds: readonly number[];
	people: number;
	maxRounds?: number;
};

export type AgentSeedResult = {
	seed: number;
	summary: GroupingSummary;
	leakage: number;
	teams: string[][];
};

// The profiles of each team's members, from a finished world.
export function teamsOf(world: World): Profile[][] {
	return world.teams.map((team) =>
		team.members.map((id) => world.agents[id]!.profile),
	);
}

// Runs a simulation for every seed at once (they share `client`, so its concurrency limit still holds) and
// returns the agents' row plus each seed's result. `onEvent(seed)` gives a listener for that seed's events,
// for example to write its run log; `onSeed` is called as each seed finishes.
export async function evaluateAgents(
	client: LlmClient,
	{ seeds, people, maxRounds }: AgentEvalSettings,
	{
		onEvent,
		onSeed,
	}: {
		onEvent?: (seed: number) => (event: RunEvent) => void;
		onSeed?: (result: AgentSeedResult) => void;
	} = {},
): Promise<{ row: MethodResult; perSeed: AgentSeedResult[] }> {
	const perSeed = await Promise.all(
		seeds.map(async (seed): Promise<AgentSeedResult> => {
			const listener = onEvent?.(seed);
			const world = await runSimulation(
				client,
				generateProfiles(people, seed),
				{
					...(maxRounds && { maxRounds }),
					...(listener && { onEvent: listener }),
				},
			);
			const result = {
				seed,
				summary: summarize(teamsOf(world), people),
				leakage: measureLeakage(world).rate,
				teams: world.teams.map((team) => team.members),
			};
			onSeed?.(result);
			return result;
		}),
	);
	return {
		row: resultFrom(
			"agents",
			perSeed.map((r) => r.summary),
			perSeed.map((r) => r.leakage),
			false,
		),
		perSeed,
	};
}
