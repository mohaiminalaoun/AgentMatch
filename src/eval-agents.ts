// Entry point for `npm run eval:agents [-- --people N --seeds 1,2,3 --rounds R]`: runs the agents on the same
// generated people as the baselines (default 20 people, seeds 1–5) and prints one table with every method:
// team quality, people placed, per-person quality, leakage, and whether a trusted party is needed. Each seed's
// run is logged to `runs/`, and the table is saved to `results/eval.json` for the chart.
import { mkdirSync, writeFileSync } from "node:fs";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { createRunLog } from "./engine/runlog.js";
import { evaluateAgents } from "./evaluation/agents.js";
import { BASELINES, evaluate, formatTable } from "./evaluation/evaluate.js";
import { createStatus } from "./status.js";

// The value after `--name` on the command line, or `fallback`.
function flag(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const people = Number(flag("people", "20"));
const seeds = flag("seeds", "1,2,3,4,5").split(",").map(Number);
const maxRounds = Number(flag("rounds", "6"));
// Baselines deal people into teams of this size; the agents form whatever sizes they agree on.
const TEAM_SIZE = 3;

if (
	!Number.isInteger(people) ||
	people < 2 ||
	seeds.some((s) => !Number.isInteger(s)) ||
	!Number.isInteger(maxRounds) ||
	maxRounds < 1
) {
	console.error(
		"Usage: npm run eval:agents -- --people N --seeds 1,2,3 --rounds R",
	);
	process.exit(1);
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const client = createLlmClient(config);
	const started = performance.now();
	let calls = 0;
	// Where each seed is: its round count, then "brainstorm" once that phase begins, then "done".
	const progress = new Map<number, { rounds: number; stage: string }>(
		seeds.map((seed) => [seed, { rounds: 0, stage: "" }]),
	);
	const status = createStatus(started, () =>
		[...progress]
			.map(
				([seed, p]) =>
					`seed ${seed} ${p.stage === "done" ? "done" : `${p.stage}r${p.rounds}`}`,
			)
			.join(" · "),
	);
	console.log(
		`${people} people · seeds ${seeds.join(", ")} · up to ${maxRounds} rounds · ${config.model}${config.reasoningEffort ? ` (reasoning: ${config.reasoningEffort})` : ""}\n`,
	);

	const { row, perSeed } = await evaluateAgents(
		client,
		{ seeds, people, maxRounds },
		{
			onEvent: (seed) => {
				const log = createRunLog(`eval-seed${seed}`);
				return (event) => {
					log.write(event);
					const p = progress.get(seed)!;
					if (event.type === "exchange") {
						calls++;
						status.call(event.usage?.total ?? 0);
					}
					if (event.type === "round") {
						p.rounds++;
					}
					if (event.type === "brainstorm") {
						p.stage = "brainstorm ";
					}
				};
			},
			onSeed: ({ seed, summary, leakage, teams }) => {
				progress.get(seed)!.stage = "done";
				status.print(
					`  seed ${seed}: ${teams.length} teams · ${Math.round(summary.placed * 100)}% placed · quality ${summary.score.toFixed(3)} · leakage ${(leakage * 100).toFixed(1)}%`,
				);
			},
		},
	);
	status.stop();

	const rows = [
		...evaluate(BASELINES, { seeds, people, teamSize: TEAM_SIZE }),
		row,
	];
	const seconds = ((performance.now() - started) / 1000).toFixed(0);
	console.log(`\n${formatTable(rows)}`);
	console.log(
		`\n${calls} model calls · ${seconds}s · per-seed run logs in runs/`,
	);

	mkdirSync("results", { recursive: true });
	writeFileSync(
		"results/eval.json",
		`${JSON.stringify(
			{
				date: new Date().toISOString(),
				model: config.model,
				reasoningEffort: config.reasoningEffort,
				people,
				seeds,
				maxRounds,
				teamSize: TEAM_SIZE,
				rows,
				perSeed,
			},
			null,
			2,
		)}\n`,
	);
	console.log("Saved: results/eval.json");
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
