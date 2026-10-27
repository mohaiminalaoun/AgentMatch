import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Exchange } from "../../src/engine/llm.js";
import { createRunLog, readRunLog } from "../../src/engine/runlog.js";

const exchange: Exchange = {
	messages: [
		{ role: "system", content: "Be brief." },
		{ role: "user", content: "Hi" },
	],
	reply: "Hello!",
	usage: { input: 10, output: 2, total: 12 },
};

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "runlog-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("run log", () => {
	test("names the file after the time and label, inside the folder", () => {
		const log = createRunLog("decide", dir);
		expect(log.path.startsWith(dir)).toBe(true);
		expect(log.path).toMatch(/\d{4}-\d{2}-\d{2}T[\d-]+Z-decide\.jsonl$/);
	});

	test("writes one JSON line per exchange", () => {
		const log = createRunLog("test", dir);
		log.write(exchange);
		log.write(exchange);
		const lines = readFileSync(log.path, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[0]!).reply).toBe("Hello!");
	});

	test("reads back exactly what was written, with a timestamp", () => {
		const log = createRunLog("test", dir);
		log.write(exchange);
		const [entry] = readRunLog(log.path);
		expect(entry).toMatchObject(exchange);
		expect(new Date(entry!.time).toString()).not.toBe("Invalid Date");
	});

	test("an exchange without usage reads back as undefined usage", () => {
		const log = createRunLog("test", dir);
		log.write({ ...exchange, usage: undefined });
		expect(readRunLog(log.path)[0]!.usage).toBeUndefined();
	});

	test("creates the folder if it doesn't exist", () => {
		const nested = join(dir, "a", "b");
		const log = createRunLog("test", nested);
		log.write(exchange);
		expect(readRunLog(log.path)).toHaveLength(1);
	});

	test("a corrupted line is reported with its line number", () => {
		const path = join(dir, "broken.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({ ...exchange, time: "t" })}\n{oops\n`,
		);
		expect(() => readRunLog(path)).toThrow("line 2 is not valid JSON");
	});

	test("blank lines are skipped without shifting line numbers", () => {
		const path = join(dir, "gaps.jsonl");
		const good = JSON.stringify({ ...exchange, time: "t" });
		writeFileSync(path, `${good}\n\n{oops\n`);
		expect(() => readRunLog(path)).toThrow("line 3 is not valid JSON");
	});

	test("a line with the wrong shape is reported", () => {
		const path = join(dir, "wrong.jsonl");
		writeFileSync(path, `${JSON.stringify({ hello: "world" })}\n`);
		expect(() => readRunLog(path)).toThrow(
			"line 1 is not a logged exchange",
		);
	});
});
