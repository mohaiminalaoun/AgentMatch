import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RunEvent } from "./events.js";

// Gitignored: logs can hold real people's data once real users take part.
export const RUNS_DIR = "runs";

export type RunLog = {
	path: string;
	write: (event: RunEvent) => void;
};

// Starts a new JSONL log named after the current time and `label`, creating the folder if needed.
// Each line is one run event.
export function createRunLog(label: string, dir = RUNS_DIR): RunLog {
	mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const path = join(dir, `${stamp}-${label}.jsonl`);
	return {
		path,
		write: (event) => appendFileSync(path, `${JSON.stringify(event)}\n`),
	};
}

// Reads a JSONL run log back into events, checking every line, since the file may have been edited
// or cut off. Lines from older logs, which held only model calls and no `type`, read as exchanges.
export function readRunLog(path: string): RunEvent[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.flatMap((line, i) => {
			if (line.trim() === "") {
				return [];
			}
			let json: unknown;
			try {
				json = JSON.parse(line);
			} catch {
				throw new Error(`${path} line ${i + 1} is not valid JSON`);
			}
			const isLegacyExchange =
				typeof json === "object" &&
				json !== null &&
				!("type" in json) &&
				"messages" in json;
			const parsed = RunEvent.safeParse(
				isLegacyExchange
					? { type: "exchange", ...(json as Record<string, unknown>) }
					: json,
			);
			if (!parsed.success) {
				const issue = parsed.error.issues[0];
				throw new Error(
					`${path} line ${i + 1} is not a run event: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`,
				);
			}
			return [parsed.data];
		});
}
