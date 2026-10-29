import { describe, expect, test } from "vitest";
import {
	BASELINES,
	broadcastLeakage,
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
			"broadcast",
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
		expect(lines).toHaveLength(5);
		expect(lines[0]).toContain("Avg score");
		expect(lines[0]).toContain("Leakage");
		expect(lines[1]).toMatch(/^random/);
		expect(lines[2]).toMatch(/^greedy/);
		expect(lines[3]).toMatch(/^local search/);
		expect(lines[4]).toMatch(/^broadcast/);
	});
});

describe("privacy", () => {
	const fe = [{ name: "frontend", level: "expert" as const }];
	const p = (id: string) => person(id, fe, ["climate"], 0);

	test("a broadcast leaks everything to everyone outside each person's team", () => {
		// Two teams of 2 among 4 people: each person's fields reach 2 of their 3 others.
		expect(
			broadcastLeakage([
				[p("a"), p("b")],
				[p("c"), p("d")],
			]),
		).toBeCloseTo(2 / 3);
		// One team with everyone: there are no outsiders.
		expect(broadcastLeakage([[p("a"), p("b"), p("c")]])).toBe(0);
	});

	test("central matchers leak nothing to participants but need a trusted party; broadcast is the reverse", () => {
		const rows = evaluate(BASELINES, settings);
		const row = (method: string) => rows.find((r) => r.method === method)!;
		expect(row("local search")).toMatchObject({
			leakage: 0,
			central: true,
		});
		expect(row("broadcast").central).toBe(false);
		// 40 people in teams of about 3: each person's fields reach about 37 of 39 others.
		expect(row("broadcast").leakage).toBeGreaterThan(0.9);
		// Same teams as local search, so the same quality.
		expect(row("broadcast").score).toBe(row("local search").score);
	});

	test("baselines place everyone, so their per-person quality is their teams' quality", () => {
		for (const row of evaluate(BASELINES, settings)) {
			expect(row.placed).toBe(1);
		}
	});

	test("people left without a team count as 0 in the per-person quality", () => {
		const team = [p("a"), p("b")];
		const placedOnly = summarize([team]);
		const withTwoLeft = summarize([team], 4);
		expect(withTwoLeft.placed).toBe(0.5);
		expect(withTwoLeft.overall).toBeCloseTo(placedOnly.overall / 2);
	});
});
