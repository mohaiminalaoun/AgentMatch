import type { Profile } from "../engine/profile.js";
import { sample, type Rng } from "../engine/random.js";

// Every method uses the same team size so comparisons between them are fair.
export const DEFAULT_TEAM_SIZE = 3;

// Shuffles everyone and deals them into teams like cards; the floor every real method must beat.
export function randomMatching(
	profiles: readonly Profile[],
	rng: Rng,
	teamSize = DEFAULT_TEAM_SIZE,
): Profile[][] {
	const teamCount = teamCountFor(profiles.length, teamSize);
	const shuffled = sample(rng, profiles, profiles.length);
	const teams: Profile[][] = Array.from({ length: teamCount }, () => []);
	// Dealing in turn puts leftovers in different teams, so sizes differ by at most 1.
	shuffled.forEach((profile, i) => teams[i % teamCount]!.push(profile));
	return teams;
}

// How many teams `people` fill at `teamSize`; leftovers join existing teams rather than being dropped.
function teamCountFor(people: number, teamSize: number): number {
	if (!Number.isInteger(teamSize) || teamSize < 2) {
		throw new Error(
			`team size must be an integer of at least 2, got ${teamSize}`,
		);
	}
	if (people < teamSize) {
		throw new Error(`need at least ${teamSize} profiles, got ${people}`);
	}
	return Math.floor(people / teamSize);
}
