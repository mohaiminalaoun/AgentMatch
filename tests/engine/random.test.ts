import { expect, test } from "vitest";
import { createRng, type Rng } from "../../src/engine/random.js";

function take(rng: Rng, n: number): number[] {
	return Array.from({ length: n }, () => rng());
}

test("the same seed gives the same numbers", () => {
	expect(take(createRng(42), 100)).toEqual(take(createRng(42), 100));
});

// Pins the exact output, so editing a constant in the algorithm fails this test.
test("seed 42 gives the known sequence", () => {
	const values = take(createRng(42), 3).map((v) => v.toFixed(4));
	expect(values).toEqual(["0.6011", "0.4483", "0.8525"]);
});

test("different seeds give different numbers", () => {
	expect(take(createRng(1), 10)).not.toEqual(take(createRng(2), 10));
});

test("generators with the same seed don't affect each other", () => {
	const a = createRng(42);
	const b = createRng(42);
	a();
	a();
	expect(b()).toBe(createRng(42)());
});

test("numbers are in [0, 1) and spread out", () => {
	const values = take(createRng(7), 10_000);
	expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
	const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
	expect(mean).toBeGreaterThan(0.48);
	expect(mean).toBeLessThan(0.52);
});

test("a non-integer seed throws", () => {
	expect(() => createRng(1.5)).toThrow();
});
