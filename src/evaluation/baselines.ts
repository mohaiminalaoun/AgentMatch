import type { Profile } from "../engine/profile.js";
import { sample, type Rng } from "../engine/random.js";
import { scoreTeam } from "./quality.js";

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

// Builds teams one at a time, always adding whoever raises the score most; never revisits a choice.
export function greedyMatching(
	profiles: readonly Profile[],
	teamSize = DEFAULT_TEAM_SIZE,
): Profile[][] {
	const teamCount = teamCountFor(profiles.length, teamSize);
	const unassigned = [...profiles];
	const teams: Profile[][] = [];
	for (let i = 0; i < teamCount; i++) {
		const team = [unassigned.shift()!];
		while (team.length < teamSize) {
			team.push(takeBestFit(team, unassigned));
		}
		teams.push(team);
	}
	// Same size cap as random dealing gives, so both methods end with the same team sizes.
	const maxSize = Math.ceil(profiles.length / teamCount);
	for (const person of unassigned) {
		const open = teams.filter((team) => team.length < maxSize);
		bestTeamFor(person, open).push(person);
	}
	return teams;
}

// Removes and returns the candidate who gives `team` the highest score; ties go to the earliest.
function takeBestFit(team: readonly Profile[], candidates: Profile[]): Profile {
	let bestIndex = 0;
	let bestScore = -Infinity;
	candidates.forEach((candidate, i) => {
		const score = scoreTeam([...team, candidate]);
		if (score > bestScore) {
			bestIndex = i;
			bestScore = score;
		}
	});
	return candidates.splice(bestIndex, 1)[0]!;
}

// The team whose score rises the most if `person` joins; ties go to the earliest.
function bestTeamFor(person: Profile, teams: Profile[][]): Profile[] {
	let best = teams[0]!;
	let bestGain = -Infinity;
	for (const team of teams) {
		const gain = scoreTeam([...team, person]) - scoreTeam(team);
		if (gain > bestGain) {
			best = team;
			bestGain = gain;
		}
	}
	return best;
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
