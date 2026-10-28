// Entry point for `npm run show-run [file] [--prompts]`: prints a run log as a timeline, defaulting to the
// newest log. With --prompts, every model call is printed in full.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { formatRun } from "./describe.js";
import { readRunLog, RUNS_DIR } from "./engine/runlog.js";

try {
	const args = process.argv.slice(2);
	const prompts = args.includes("--prompts");
	const path = args.find((arg) => !arg.startsWith("--")) ?? newestLog();
	const events = readRunLog(path);
	console.log(`${path} · ${events.length} events\n`);
	console.log(formatRun(events, { prompts }));
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}

// The most recent log in the runs folder; timestamped names sort in time order.
function newestLog(): string {
	let names: string[] = [];
	try {
		names = readdirSync(RUNS_DIR).filter((name) => name.endsWith(".jsonl"));
	} catch {
		// No runs folder yet: handled below.
	}
	const newest = names.sort().at(-1);
	if (!newest) {
		throw new Error(
			`No logs in ${RUNS_DIR}/ yet. Run npm run negotiate first.`,
		);
	}
	return join(RUNS_DIR, newest);
}
