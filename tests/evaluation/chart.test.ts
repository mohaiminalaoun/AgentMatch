import { describe, expect, test } from "vitest";
import { chartSvg } from "../../src/evaluation/chart.js";
import type { MethodResult } from "../../src/evaluation/evaluate.js";

// A result row with the fields the chart reads; the rest are placeholders.
const row = (
	method: string,
	overall: number,
	leakage: number,
	central: boolean,
	score = overall,
	placed = 1,
): MethodResult => ({
	method,
	score,
	scoreStdDev: 0,
	worst: 0,
	coverage: 0,
	interest: 0,
	overlap: 0,
	placed,
	overall,
	leakage,
	central,
});

const svg = chartSvg({
	rows: [
		row("random", 0.34, 0, true),
		row("local search", 0.59, 0, true),
		row("broadcast", 0.59, 0.874, false),
		row("agents", 0.38, 0.124, false, 0.56, 0.67),
	],
	agentSeeds: [
		{ seed: 1, overall: 0.25, leakage: 0.12 },
		{ seed: 2, overall: 0.45, leakage: 0.1 },
	],
	people: 20,
	seeds: [1, 2],
	model: "test-model",
	date: "2026-10-29T00:00:00.000Z",
});

describe("chartSvg", () => {
	test("is a standalone, labelled SVG with a text description of every method", () => {
		expect(svg.startsWith("<svg")).toBe(true);
		expect(svg).toContain('role="img"');
		expect(svg).toContain(
			'<title id="chart-title">Team quality vs. privacy leakage</title>',
		);
		expect(svg).toContain(
			"agents: per-person quality 0.380, leakage 12.4%, no trusted party",
		);
		expect(svg).toContain(
			"local search: per-person quality 0.590, leakage 0.0%, needs a trusted party",
		);
	});

	test("labels each method directly, and shows the agents' placement gap", () => {
		for (const name of ["random", "local search", "broadcast", "agents"]) {
			expect(svg).toContain(`>${name} <tspan`);
		}
		expect(svg).toContain("teams that formed 0.56");
		expect(svg).toContain("33% of people left without a team");
	});

	test("has light and dark colors, and no broken numbers", () => {
		expect(svg).toContain("prefers-color-scheme: dark");
		expect(svg).not.toMatch(/NaN|undefined|Infinity/);
	});
});
