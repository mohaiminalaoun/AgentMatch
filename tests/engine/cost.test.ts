import { expect, test } from "vitest";
import { estimateCost } from "../../src/engine/cost.js";

// Muse Spark 1.3's published prices, per million tokens.
const prices = { input: 1.25, cachedInput: 0.15, output: 4.25 };

test("charges input and output at their own rates", () => {
	expect(
		estimateCost(
			{ input: 1_000_000, output: 1_000_000, total: 2_000_000 },
			prices,
		),
	).toBeCloseTo(5.5);
});

test("charges cached input at the cached rate", () => {
	const usage = {
		input: 1_000_000,
		output: 0,
		total: 1_000_000,
		cached: 400_000,
	};
	expect(estimateCost(usage, prices)).toBeCloseTo(0.6 * 1.25 + 0.4 * 0.15);
});

test("a typical decision costs about a cent", () => {
	const decision = {
		input: 900,
		output: 1_900,
		total: 2_800,
		reasoning: 1_800,
	};
	expect(estimateCost(decision, prices)).toBeCloseTo(0.0092, 4);
});
