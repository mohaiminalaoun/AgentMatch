// Entry point for `npm run eval:decisions -- <log> [<log> ...]`: checks each run log's decisions for hard
// problems (teams outside a member's size limits, needed roles nobody on the team can do, offers that differ
// from what the owner's model chose) and prints them per log, then the totals. No model calls; prints ids
// only, never rationales.
import { basename } from "node:path";
import { readRunLog } from "./engine/runlog.js";
import { checkDecisions, describeFinding } from "./evaluation/decisions.js";

const logs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (logs.length === 0) {
	console.error("Usage: npm run eval:decisions -- <log> [<log> ...]");
	process.exit(1);
}

try {
	const totals = new Map<string, number>();
	for (const log of logs) {
		const report = checkDecisions(readRunLog(log));
		console.log(
			`${basename(log)} · ${report.teams} teams · ${report.placed}/${report.people} placed · ${report.fellBack} fallbacks · ${report.profiles}/${report.people} profiles found`,
		);
		for (const f of report.findings) {
			console.log(`  - ${f.kind}: ${describeFinding(f)}`);
			totals.set(f.kind, (totals.get(f.kind) ?? 0) + 1);
		}
		if (report.findings.length === 0) {
			console.log("  no findings");
		}
	}
	if (logs.length > 1) {
		console.log(
			`\nTotals over ${logs.length} logs: ${[...totals].map(([k, n]) => `${k} ${n}`).join(" · ") || "no findings"}`,
		);
	}
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
