import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Exchange } from "./llm.js";

// Gitignored: logs can hold real people's data once real users take part.
export const RUNS_DIR = "runs";

// One line of a run log: an exchange plus when it happened.
export type LoggedExchange = Exchange & { time: string };

export type RunLog = {
	path: string;
	write: (exchange: Exchange) => void;
};

// Starts a new JSONL log named after the current time and `label`, creating the folder if needed.
export function createRunLog(label: string, dir = RUNS_DIR): RunLog {
	mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const path = join(dir, `${stamp}-${label}.jsonl`);
	return {
		path,
		write: (exchange) => {
			const entry: LoggedExchange = {
				time: new Date().toISOString(),
				...exchange,
			};
			appendFileSync(path, `${JSON.stringify(entry)}\n`);
		},
	};
}

// What a log line must contain; checked on read, since the file may have been edited or cut off.
const LogLine = z.object({
	time: z.string(),
	messages: z.array(
		z.object({
			role: z.enum(["system", "user", "assistant"]),
			content: z.string(),
		}),
	),
	reply: z.string(),
	usage: z
		.object({ input: z.number(), output: z.number(), total: z.number() })
		.optional(),
});

// Reads a JSONL run log back into exchanges, naming the line number of any line that isn't valid.
export function readRunLog(path: string): LoggedExchange[] {
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
			const parsed = LogLine.safeParse(json);
			if (!parsed.success) {
				throw new Error(
					`${path} line ${i + 1} is not a logged exchange`,
				);
			}
			const { time, messages, reply, usage } = parsed.data;
			return [{ time, messages, reply, usage }];
		});
}
