// Entry point for `npm run simulate [-- --agents N --rounds R --seed S]`: the whole system on generated people.
// Agents write listings, then each round pick whom to approach and negotiate, all at once. Prints a line per
// phase and a report at the end; the full timeline is in the run log (`npm run show-run`).
import { formatSummary } from "./describe.js";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import type { RunEvent } from "./engine/events.js";
import { createRunLog } from "./engine/runlog.js";
import { runSimulation, summarize } from "./engine/simulation.js";
import { generateProfiles } from "./evaluation/profiles.js";

// The value after `--name` on the command line, as a whole number, or `fallback`.
function flag(name: string, fallback: number): number {
	const i = process.argv.indexOf(`--${name}`);
	const value = i === -1 ? fallback : Number(process.argv[i + 1]);
	if (!Number.isInteger(value) || value < 1) {
		console.error(`--${name} must be a whole number of at least 1`);
		process.exit(1);
	}
	return value;
}

const agents = flag("agents", 10);
const rounds = flag("rounds", 2);
const seed = flag("seed", 1);

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("simulate");
	const client = createLlmClient(config);
	const events: RunEvent[] = [];
	const started = performance.now();

	console.log(
		`${agents} agents · ${rounds} rounds · seed ${seed} · ${config.model}\n`,
	);
	const world = await runSimulation(client, generateProfiles(agents, seed), {
		rounds,
		onEvent: (event) => {
			events.push(event);
			log.write(event);
		},
		onPhase: (line) => console.log(`  ${line}`),
	});

	const seconds = ((performance.now() - started) / 1000).toFixed(0);
	console.log(`\n${formatSummary(summarize(world, events), config.prices)}`);
	console.log(
		`Time: ${seconds}s · run log: ${log.path} (npm run show-run for the full timeline)`,
	);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
