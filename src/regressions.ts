// Entry point for `npm run regressions [-- --runs N --case <name>]`: runs every regression case (made-up
// scenarios replaying each reasoning failure seen in the pilot) N times (default 10), has a judge decide each
// time whether the failure happened, and prints a failure rate per case. Saves the results to runs/.
// Costs real credits: two calls per run (the agent's, then the judge's).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { RUNS_DIR } from "./engine/runlog.js";
import { REGRESSION_CASES, runCase } from "./evaluation/regressions.js";
import { createStatus } from "./status.js";

function flag(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}

const runs = Number(flag("runs") ?? "10");
const only = flag("case");
const cases = REGRESSION_CASES.filter((c) => !only || c.name === only);

if (!Number.isInteger(runs) || runs < 1 || cases.length === 0) {
	console.error(
		`Usage: npm run regressions -- --runs N --case <name>\nCases: ${REGRESSION_CASES.map((c) => c.name).join(", ")}`,
	);
	process.exit(1);
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const client = createLlmClient(config);
	console.log(
		`${cases.length} case${cases.length === 1 ? "" : "s"} × ${runs} runs · ${config.model}${config.reasoningEffort ? ` (reasoning: ${config.reasoningEffort})` : ""}\n`,
	);
	const started = performance.now();
	let done = 0;
	const status = createStatus(
		started,
		() => `${done}/${cases.length * runs} runs`,
	);
	const results = await Promise.all(
		cases.map((c) =>
			runCase(client, c, runs, () => {
				done++;
				status.call(0);
			}),
		),
	);
	status.stop();

	const width = Math.max(...cases.map((c) => c.name.length));
	for (const [i, r] of results.entries()) {
		const c = cases[i]!;
		const rate =
			r.runs === 0 ? "-" : `${Math.round((r.failed / r.runs) * 100)}%`;
		console.log(
			`${r.name.padEnd(width)}  failed ${r.failed}/${r.runs} (${rate})${r.errors > 0 ? ` · ${r.errors} errored` : ""}`,
		);
		console.log(`${"".padEnd(width)}  expected: ${c.expected}`);
		for (const e of r.examples) {
			console.log(
				`${"".padEnd(width)}  e.g. ${e.decision}: "${e.quote}"`,
			);
		}
		console.log();
	}

	mkdirSync(RUNS_DIR, { recursive: true });
	const out = join(
		RUNS_DIR,
		`${new Date().toISOString().replace(/[:.]/g, "-")}-regressions.json`,
	);
	writeFileSync(
		out,
		`${JSON.stringify({ model: config.model, runs, results }, null, "\t")}\n`,
	);
	console.log(`Saved: ${out}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
