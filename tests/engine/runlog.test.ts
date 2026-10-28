import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { RunEvent } from "../../src/engine/events.js";
import { createRunLog, readRunLog } from "../../src/engine/runlog.js";

const events: RunEvent[] = [
	{
		type: "round",
		time: "2026-10-28T05:53:51.000Z",
		model: "test-model",
		agents: ["kemi", "nia"],
	},
	{ type: "tick", n: 1 },
	{
		type: "bus",
		event: {
			seq: 1,
			time: "2026-10-28T05:53:52.000Z",
			type: "sent",
			message: {
				id: "prop-1",
				from: "nia",
				to: "kemi",
				pitch: "AI note-taking app",
				rolesNeeded: ["frontend"],
			},
		},
	},
	{
		type: "decision",
		agent: "kemi",
		proposalId: "prop-1",
		decision: { decision: "accept" },
		rationale: "Fits.",
		gateBlocks: 0,
		fellBack: false,
	},
	{ type: "level", agent: "kemi", other: "nia", from: 0, to: 1 },
	{
		type: "interest",
		agent: "kemi",
		other: "nia",
		level: 1,
		interest: "continue",
		rationale: "Good overlap.",
		fellBack: false,
	},
	{
		type: "exchange",
		time: "2026-10-28T05:53:53.000Z",
		messages: [{ role: "user", content: "Say hi" }],
		reply: "Hi!",
		usage: { input: 3, output: 1, total: 4 },
	},
];

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "runlog-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

// Writes `lines` to a file in the temp folder and returns its path.
function file(name: string, ...lines: string[]): string {
	const path = join(dir, name);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return path;
}

describe("run log", () => {
	test("names the file after the time and label, inside the folder", () => {
		const log = createRunLog("negotiate", dir);
		expect(log.path.startsWith(dir)).toBe(true);
		expect(log.path).toMatch(/\d{4}-\d{2}-\d{2}T[\d-]+Z-negotiate\.jsonl$/);
	});

	test("writes one JSON line per event", () => {
		const log = createRunLog("test", dir);
		events.forEach(log.write);
		const lines = readFileSync(log.path, "utf8").trim().split("\n");
		expect(lines).toHaveLength(events.length);
		expect(JSON.parse(lines[1]!)).toEqual({ type: "tick", n: 1 });
	});

	test("reads back exactly what was written, every kind of event", () => {
		const log = createRunLog("test", dir);
		events.forEach(log.write);
		expect(readRunLog(log.path)).toEqual(events);
	});

	test("creates the folder if it doesn't exist", () => {
		const log = createRunLog("test", join(dir, "a", "b"));
		log.write({ type: "tick", n: 1 });
		expect(readRunLog(log.path)).toHaveLength(1);
	});

	test("older logs, which held only model calls with no type, still read as exchanges", () => {
		const path = file(
			"old.jsonl",
			JSON.stringify({
				time: "t",
				messages: [{ role: "user", content: "Hi" }],
				reply: "Hello",
			}),
		);
		expect(readRunLog(path)).toEqual([
			{
				type: "exchange",
				time: "t",
				messages: [{ role: "user", content: "Hi" }],
				reply: "Hello",
			},
		]);
	});

	test("a corrupted line is reported with its line number, counting blank lines", () => {
		const path = file(
			"broken.jsonl",
			JSON.stringify(events[1]),
			"",
			"{oops",
		);
		expect(() => readRunLog(path)).toThrow("line 3 is not valid JSON");
	});

	test("an unknown kind of event is reported", () => {
		const path = file("unknown.jsonl", JSON.stringify({ type: "party" }));
		expect(() => readRunLog(path)).toThrow("line 1 is not a run event");
	});

	test("a logged bus message is checked with the bus's own rules", () => {
		const leakyDecline = {
			type: "bus",
			event: {
				seq: 1,
				time: "t",
				type: "sent",
				message: {
					decision: "decline",
					reason: "My human wants climate work.",
					proposalId: "prop-1",
					from: "kemi",
					to: "nia",
				},
			},
		};
		const path = file("leaky.jsonl", JSON.stringify(leakyDecline));
		expect(() => readRunLog(path)).toThrow("line 1 is not a run event");
	});
});
