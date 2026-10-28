// Entry point for `npm run simulate [-- --agents N --rounds R --seed S --private]`: the whole system on
// generated people. Agents write listings, then each round pick whom to approach and negotiate, all at once.
// Prints every event as it happens (with private rationales only under --private), a live status line while
// model calls are out, and a report at the end; the full timeline is in the run log (`npm run show-run`).
import { formatEvent, formatSummary } from "./describe.js";
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
const showPrivate = process.argv.includes("--private");

// A status line kept at the bottom of the terminal, redrawn every second, so a slow model call never looks
// like a hang. Only on a terminal: piped output gets just the event lines.
function createStatus(started: number) {
	const live = process.stdout.isTTY;
	let calls = 0;
	let tokens = 0;
	const elapsed = () => {
		const s = Math.floor((performance.now() - started) / 1000);
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
	};
	const draw = () =>
		live &&
		process.stdout.write(
			`\r\x1b[2K  ⋯ ${calls} model calls done · ${tokens.toLocaleString()} tokens · ${elapsed()}`,
		);
	const clear = () => live && process.stdout.write("\r\x1b[2K");
	const timer = setInterval(draw, 1000);
	return {
		// Counts one finished model call.
		call(used: number) {
			calls++;
			tokens += used;
			draw();
		},
		// Prints `line` above the status line.
		print(line: string) {
			clear();
			console.log(line);
			draw();
		},
		stop() {
			clearInterval(timer);
			clear();
		},
	};
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("simulate");
	const client = createLlmClient(config);
	const events: RunEvent[] = [];
	const started = performance.now();
	const status = createStatus(started);

	console.log(
		`${agents} agents · ${rounds} rounds · seed ${seed} · ${config.model}${config.reasoningEffort ? ` (reasoning: ${config.reasoningEffort})` : ""}\n`,
	);
	const world = await runSimulation(client, generateProfiles(agents, seed), {
		rounds,
		onEvent: (event) => {
			events.push(event);
			log.write(event);
			if (event.type === "exchange") {
				status.call(event.usage?.total ?? 0);
			}
			const line = formatEvent(event, { rationale: showPrivate });
			if (line !== undefined) {
				status.print(line);
			}
		},
		onPhase: (line) => status.print(`\n▸ ${line}`),
	});
	status.stop();

	const seconds = ((performance.now() - started) / 1000).toFixed(0);
	console.log(`\n${formatSummary(summarize(world, events), config.prices)}`);
	console.log(
		`Time: ${seconds}s · run log: ${log.path} (npm run show-run for the full timeline)`,
	);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
