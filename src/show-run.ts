// Entry point for `npm run show-run [file]`: prints a run log as a readable transcript; defaults to the newest log.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { formatExchange } from "./engine/llm.js";
import { readRunLog, RUNS_DIR } from "./engine/runlog.js";

try {
	const path = process.argv[2] ?? newestLog();
	const entries = readRunLog(path);
	console.log(`${path} · ${entries.length} exchanges\n`);
	entries.forEach((entry, i) => {
		const tokens = entry.usage
			? `${entry.usage.total} tokens`
			: "usage unknown";
		console.log(`═══ exchange ${i + 1} · ${entry.time} · ${tokens} ═══\n`);
		console.log(`${formatExchange(entry)}\n`);
	});
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
			`No logs in ${RUNS_DIR}/ yet. Run npm run decide first.`,
		);
	}
	return join(RUNS_DIR, newest);
}
