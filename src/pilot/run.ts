import type { LlmClient } from "../engine/client.js";
import type { RunEvent } from "../engine/events.js";
import type { World } from "../engine/round.js";
import { runSimulation } from "../engine/simulation.js";
import { generateProfiles } from "../evaluation/profiles.js";
import type { PilotPerson } from "./person.js";

export type PilotOptions = {
	// Generated people added to the board, so a handful of real people aren't alone on it. Their ids ("p1", …)
	// can never clash with a real person's ("p-…").
	fill?: number;
	// Seed for the generated people.
	seed?: number;
	maxRounds?: number;
	onEvent?: (event: RunEvent) => void;
	onPhase?: (line: string) => void;
};

// Where one real person ended up: on a team (with the version of the project it builds), or not.
export type PilotOutcome = {
	id: string;
	name: string;
	team?: { members: string[]; project: string } | undefined;
};

// Runs the whole system for real people, plus `fill` generated ones. Each person's notes go to their own
// agent, and names stay unshared even within teams: they wait until every member's human approves.
export async function runPilot(
	client: LlmClient,
	people: readonly PilotPerson[],
	{ fill = 0, seed = 1, maxRounds, onEvent, onPhase }: PilotOptions = {},
): Promise<World> {
	return runSimulation(
		client,
		[...people.map((p) => p.profile), ...generateProfiles(fill, seed)],
		{
			notes: Object.fromEntries(
				people.map((p) => [p.profile.id, p.notes]),
			),
			revealNames: false,
			...(maxRounds && { maxRounds }),
			...(onEvent && { onEvent }),
			...(onPhase && { onPhase }),
		},
	);
}

// Each real person's outcome, in the order given. Teammates are listed by id: who they are is for the
// humans to learn once everyone approves.
export function pilotOutcomes(
	world: World,
	people: readonly PilotPerson[],
): PilotOutcome[] {
	return people.map(({ profile }) => {
		const team = world.teams.find((t) => t.members.includes(profile.id));
		return {
			id: profile.id,
			name: profile.name,
			team: team && {
				members: team.members,
				project: team.project.description,
			},
		};
	});
}
