import type { Profile } from "../engine/profile.js";
import { createRng, type Rng } from "../engine/random.js";
import {
	greedyMatching,
	localSearchMatching,
	randomMatching,
} from "./baselines.js";
import { generateProfiles } from "./profiles.js";
import {
	availabilityOverlap,
	scoreTeam,
	sharedInterest,
	skillCoverage,
} from "./quality.js";

// The shape every matching method shares, so adding one is a single entry in a list.
export type Matcher = (
	profiles: readonly Profile[],
	rng: Rng,
	teamSize: number,
) => Profile[][];

// Where a method's information goes. "central": one trusted party sees every full profile and the
// participants see nothing of each other. "broadcast": everyone sees everyone's full profile.
export type Privacy = "central" | "broadcast";

export type Method = { match: Matcher; privacy: Privacy };

const localSearch: Matcher = (profiles, _rng, teamSize) =>
	localSearchMatching(profiles, teamSize);

export const BASELINES: Record<string, Method> = {
	random: { match: randomMatching, privacy: "central" },
	greedy: {
		match: (profiles, _rng, teamSize) => greedyMatching(profiles, teamSize),
		privacy: "central",
	},
	"local search": { match: localSearch, privacy: "central" },
	// Everyone posts their full profile and teams form with full information: the best people could do by
	// sharing everything, so local search's teams, at the cost of a full broadcast.
	broadcast: { match: localSearch, privacy: "broadcast" },
};

export type EvalSettings = {
	seeds: readonly number[];
	people: number;
	teamSize: number;
};

// Averages over one grouping's teams, plus how many of the people were placed and the quality each person
// got: their team's score, or 0 for anyone left without a team.
export type GroupingSummary = {
	score: number;
	worst: number;
	coverage: number;
	interest: number;
	overlap: number;
	placed: number;
	overall: number;
};

// A GroupingSummary averaged over seeds, plus how much the score varied between them, the share of private
// fields that reached people outside their own team, and whether the method needs a trusted central party.
export type MethodResult = GroupingSummary & {
	method: string;
	scoreStdDev: number;
	leakage: number;
	central: boolean;
};

// Matchers shuffle with a different seed than the one that made the people,
// so the shuffle doesn't replay the generator's random stream.
const MATCHING_SEED_OFFSET = 1_000_000;

// Scores one grouping of `people` people (everyone in the teams, by default): the mean of each quality part
// across its teams, its worst team, the share of people placed, and the mean quality per person.
export function summarize(
	teams: readonly Profile[][],
	people = teams.reduce((sum, team) => sum + team.length, 0),
): GroupingSummary {
	const placed = teams.reduce((sum, team) => sum + team.length, 0);
	return {
		score: teams.length > 0 ? mean(teams.map(scoreTeam)) : 0,
		worst: teams.length > 0 ? Math.min(...teams.map(scoreTeam)) : 0,
		coverage: teams.length > 0 ? mean(teams.map(skillCoverage)) : 0,
		interest: teams.length > 0 ? mean(teams.map(sharedInterest)) : 0,
		overlap: teams.length > 0 ? mean(teams.map(availabilityOverlap)) : 0,
		placed: people > 0 ? placed / people : 0,
		overall:
			people > 0
				? teams.reduce(
						(sum, team) => sum + scoreTeam(team) * team.length,
						0,
					) / people
				: 0,
	};
}

// The leakage of a full broadcast with these teams, on the same scale as measureLeakage: everyone's private
// fields reach every other person, so all but their teammates are outsiders.
export function broadcastLeakage(teams: readonly Profile[][]): number {
	const people = teams.reduce((sum, team) => sum + team.length, 0);
	if (people < 2) {
		return 0;
	}
	const outsiders = teams.reduce(
		(sum, team) => sum + team.length * (people - team.length),
		0,
	);
	return outsiders / (people * (people - 1));
}

// Runs every matcher on the same people for each seed; one result row per matcher.
export function evaluate(
	methods: Record<string, Method>,
	settings: EvalSettings,
): MethodResult[] {
	if (settings.seeds.length === 0) {
		throw new Error("need at least one seed");
	}
	const populations = settings.seeds.map((seed) => ({
		seed,
		profiles: generateProfiles(settings.people, seed),
	}));
	return Object.entries(methods).map(([method, { match, privacy }]) => {
		const groupings = populations.map(({ seed, profiles }) =>
			match(
				profiles,
				createRng(seed + MATCHING_SEED_OFFSET),
				settings.teamSize,
			),
		);
		// A central matcher shows the participants nothing of each other; a broadcast shows them everything.
		return resultFrom(
			method,
			groupings.map((teams) => summarize(teams)),
			groupings.map((teams) =>
				privacy === "broadcast" ? broadcastLeakage(teams) : 0,
			),
			privacy === "central",
		);
	});
}

// One result row from a method's per-seed summaries and leakages, averaged over the seeds.
export function resultFrom(
	method: string,
	summaries: readonly GroupingSummary[],
	leakages: readonly number[],
	central: boolean,
): MethodResult {
	const values = (key: keyof GroupingSummary) => summaries.map((s) => s[key]);
	return {
		method,
		score: mean(values("score")),
		scoreStdDev: stdDev(values("score")),
		worst: mean(values("worst")),
		coverage: mean(values("coverage")),
		interest: mean(values("interest")),
		overlap: mean(values("overlap")),
		placed: mean(values("placed")),
		overall: mean(values("overall")),
		leakage: mean(leakages),
		central,
	};
}

const COLUMNS: [header: string, cell: (row: MethodResult) => string][] = [
	["Method", (r) => r.method],
	["Avg score", (r) => `${r.score.toFixed(3)} ± ${r.scoreStdDev.toFixed(3)}`],
	["Worst team", (r) => r.worst.toFixed(3)],
	["Coverage", (r) => r.coverage.toFixed(3)],
	["Interest", (r) => r.interest.toFixed(3)],
	["Overlap", (r) => r.overlap.toFixed(3)],
	["Placed", (r) => `${Math.round(r.placed * 100)}%`],
	["Overall", (r) => r.overall.toFixed(3)],
	["Leakage", (r) => `${(r.leakage * 100).toFixed(1)}%`],
	["Trusted party", (r) => (r.central ? "needed" : "none")],
];

// Lays out result rows as an aligned text table for the terminal.
export function formatTable(rows: readonly MethodResult[]): string {
	const grid = [
		COLUMNS.map(([header]) => header),
		...rows.map((row) => COLUMNS.map(([, cell]) => cell(row))),
	];
	const widths = COLUMNS.map((_, col) =>
		Math.max(...grid.map((line) => line[col]!.length)),
	);
	return grid
		.map((line) =>
			line
				.map((text, col) => text.padEnd(widths[col]!))
				.join("   ")
				.trimEnd(),
		)
		.join("\n");
}

// The arithmetic mean of a non-empty list.
function mean(values: readonly number[]): number {
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Sample standard deviation (divides by n - 1, since seeds are a sample); 0 for one value.
function stdDev(values: readonly number[]): number {
	if (values.length < 2) {
		return 0;
	}
	const m = mean(values);
	const squares = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
	return Math.sqrt(squares / (values.length - 1));
}
