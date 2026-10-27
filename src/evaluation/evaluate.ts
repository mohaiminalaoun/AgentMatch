import type { Profile } from "../engine/profile.js";
import { createRng, type Rng } from "../engine/random.js";
import { greedyMatching, randomMatching } from "./baselines.js";
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

export const BASELINES: Record<string, Matcher> = {
	random: randomMatching,
	greedy: (profiles, _rng, teamSize) => greedyMatching(profiles, teamSize),
};

export type EvalSettings = {
	seeds: readonly number[];
	people: number;
	teamSize: number;
};

// Averages over one grouping's teams.
export type GroupingSummary = {
	score: number;
	worst: number;
	coverage: number;
	interest: number;
	overlap: number;
};

// A GroupingSummary averaged over seeds, plus how much the score varied between them.
export type MethodResult = GroupingSummary & {
	method: string;
	scoreStdDev: number;
};

// Matchers shuffle with a different seed than the one that made the people,
// so the shuffle doesn't replay the generator's random stream.
const MATCHING_SEED_OFFSET = 1_000_000;

// Scores one grouping: the mean of each quality part across its teams, and its worst team.
export function summarize(teams: readonly Profile[][]): GroupingSummary {
	return {
		score: mean(teams.map(scoreTeam)),
		worst: Math.min(...teams.map(scoreTeam)),
		coverage: mean(teams.map(skillCoverage)),
		interest: mean(teams.map(sharedInterest)),
		overlap: mean(teams.map(availabilityOverlap)),
	};
}

// Runs every matcher on the same people for each seed; one result row per matcher.
export function evaluate(
	matchers: Record<string, Matcher>,
	settings: EvalSettings,
): MethodResult[] {
	if (settings.seeds.length === 0) {
		throw new Error("need at least one seed");
	}
	const populations = settings.seeds.map((seed) => ({
		seed,
		profiles: generateProfiles(settings.people, seed),
	}));
	return Object.entries(matchers).map(([method, match]) => {
		const summaries = populations.map(({ seed, profiles }) =>
			summarize(
				match(
					profiles,
					createRng(seed + MATCHING_SEED_OFFSET),
					settings.teamSize,
				),
			),
		);
		const values = (key: keyof GroupingSummary) =>
			summaries.map((s) => s[key]);
		return {
			method,
			score: mean(values("score")),
			scoreStdDev: stdDev(values("score")),
			worst: mean(values("worst")),
			coverage: mean(values("coverage")),
			interest: mean(values("interest")),
			overlap: mean(values("overlap")),
		};
	});
}

const COLUMNS: [header: string, cell: (row: MethodResult) => string][] = [
	["Method", (r) => r.method],
	["Avg score", (r) => `${r.score.toFixed(3)} ± ${r.scoreStdDev.toFixed(3)}`],
	["Worst team", (r) => r.worst.toFixed(3)],
	["Coverage", (r) => r.coverage.toFixed(3)],
	["Interest", (r) => r.interest.toFixed(3)],
	["Overlap", (r) => r.overlap.toFixed(3)],
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
