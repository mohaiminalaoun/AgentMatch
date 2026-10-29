// Entry point for `npm run chart`: draws the privacy vs. quality chart from `results/eval.json` (written by
// `npm run eval:agents`) into `results/chart.svg`. No model calls.
import { readFileSync, writeFileSync } from "node:fs";
import type { AgentSeedResult } from "./evaluation/agents.js";
import { chartSvg } from "./evaluation/chart.js";
import type { MethodResult } from "./evaluation/evaluate.js";

try {
	const results = JSON.parse(readFileSync("results/eval.json", "utf8")) as {
		rows: MethodResult[];
		perSeed: AgentSeedResult[];
		people: number;
		seeds: number[];
		model: string;
		date: string;
	};
	const svg = chartSvg({
		rows: results.rows,
		agentSeeds: results.perSeed.map((s) => ({
			seed: s.seed,
			overall: s.summary.overall,
			leakage: s.leakage,
		})),
		people: results.people,
		seeds: results.seeds,
		model: results.model,
		date: results.date,
	});
	writeFileSync("results/chart.svg", `${svg}\n`);
	console.log("Saved: results/chart.svg");
} catch (error) {
	console.error(
		`${(error as Error).message}\nRun npm run eval:agents first to create results/eval.json.`,
	);
	process.exit(1);
}
