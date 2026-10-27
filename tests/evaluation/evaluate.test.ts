import { describe, expect, test } from "vitest";
import {
	BASELINES,
	evaluate,
	formatTable,
	summarize,
} from "../../src/evaluation/evaluate.js";
import { person } from "../fixtures.js";

const settings = { seeds: [1, 2, 3], people: 40, teamSize: 3 };

describe("summarize", () => {
	const fe = [{ name: "frontend", level: "expert" as const }];
	// Coverage 0.25, interest 1, overlap 1: score 0.75.
	const aligned = [
		person("a", fe, ["climate"], 0),
		person("b", fe, ["climate"], 0),
	];
	// Coverage 0.25, interest 0, overlap 0: score 0.25 / 3.
	const scattered = [
		person("c", fe, ["climate"], -5),
		person("d", fe, ["music"], 8),
	];
	const summary = summarize([aligned, scattered]);

	test("averages each part across teams", () => {
		expect(summary.coverage).toBe(0.25);
		expect(summary.interest).toBe(0.5);
		expect(summary.overlap).toBe(0.5);
		expect(summary.score).toBeCloseTo((0.75 + 0.25 / 3) / 2);
	});

	test("reports the worst team's score", () => {
		expect(summary.worst).toBeCloseTo(0.25 / 3);
	});
});

describe("evaluate", () => {
	test("returns one row per matcher, in order", () => {
		const rows = evaluate(BASELINES, settings);
		expect(rows.map((r) => r.method)).toEqual([
			"random",
			"greedy",
			"local search",
		]);
	});

	test("gives the same results every run", () => {
		expect(evaluate(BASELINES, settings)).toEqual(
			evaluate(BASELINES, settings),
		);
	});

	test("greedy beats random on average and on the worst team", () => {
		const [random, greedy] = evaluate(BASELINES, settings);
		expect(greedy!.score).toBeGreaterThan(random!.score);
		expect(greedy!.worst).toBeGreaterThan(random!.worst);
	});

	test("a single seed has no spread", () => {
		const [random] = evaluate(BASELINES, { ...settings, seeds: [1] });
		expect(random!.scoreStdDev).toBe(0);
	});

	test("no seeds throws", () => {
		expect(() => evaluate(BASELINES, { ...settings, seeds: [] })).toThrow();
	});
});

describe("formatTable", () => {
	test("has a header and a line per method", () => {
		const lines = formatTable(evaluate(BASELINES, settings)).split("\n");
		expect(lines).toHaveLength(4);
		expect(lines[0]).toContain("Avg score");
		expect(lines[1]).toMatch(/^random/);
		expect(lines[2]).toMatch(/^greedy/);
		expect(lines[3]).toMatch(/^local search/);
	});
});
