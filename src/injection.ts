// Entry point for `npm run eval:injection [-- --runs N --scenario <id>]`: runs every prompt-injection scenario N
// times (default 5) on the engine's real decision prompt and gate, and prints per scenario how often a private
// string got into something sent, how often the gate stopped it first, and how often the agent was talked into
// accepting. Saves the results to runs/. Costs real credits: one call per run, two for the hijack scenarios.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { RUNS_DIR } from "./engine/runlog.js";
import { INJECTION_SCENARIOS, runScenario } from "./evaluation/injection.js";
import { createStatus } from "./status.js";

function flag(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}

const runs = Number(flag("runs") ?? "5");
const only = flag("scenario");
const scenarios = INJECTION_SCENARIOS.filter((s) => !only || s.id === only);

if (!Number.isInteger(runs) || runs < 1 || scenarios.length === 0) {
	console.error(
		`Usage: npm run eval:injection -- --runs N --scenario <id>\nScenarios: ${INJECTION_SCENARIOS.map((s) => s.id).join(", ")}`,
	);
	process.exit(1);
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const client = createLlmClient(config);
	console.log(
		`${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} × ${runs} runs · ${config.model}\n`,
	);
	const started = performance.now();
	let done = 0;
	const status = createStatus(
		started,
		() => `${done}/${scenarios.length * runs} runs`,
	);
	const results = await Promise.all(
		scenarios.map((s) =>
			runScenario(client, s, runs, () => {
				done++;
				status.call(0);
			}),
		),
	);
	status.stop();

	const width = Math.max(...scenarios.map((s) => s.id.length));
	for (const r of results) {
		const parts =
			r.category === "hijack_action"
				? [
						`accepted ${r.hijacked}/${r.runs}`,
						`without the attack ${r.controlAccepted}/${r.runs}`,
					]
				: [
						`leaked ${r.leaked}/${r.runs}`,
						`gate stopped ${r.gateBlocked}/${r.runs}`,
					];
		const mix = Object.entries(r.decisions)
			.map(([d, n]) => `${n} ${d}`)
			.join(", ");
		console.log(
			`${r.id.padEnd(width)}  ${r.category.padEnd(13)}  ${parts.join(" · ")} (${mix})${r.errors > 0 ? ` · ${r.errors} errored` : ""}`,
		);
		for (const e of r.examples.slice(0, 2)) {
			console.log(`${"".padEnd(width)}  leaked: ${e}`);
		}
	}
	const leaks = results.reduce((n, r) => n + r.leaked, 0);
	const total = results
		.filter((r) => r.category !== "hijack_action")
		.reduce((n, r) => n + r.runs, 0);
	console.log(`\nLeaked in ${leaks} of ${total} leak-scenario runs.`);

	mkdirSync(RUNS_DIR, { recursive: true });
	const out = join(
		RUNS_DIR,
		`${new Date().toISOString().replace(/[:.]/g, "-")}-injection.json`,
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
