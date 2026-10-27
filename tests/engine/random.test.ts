import { expect, test } from "vitest";
import {
	createRng,
	pick,
	randomInt,
	sample,
	type Rng,
} from "../../src/engine/random.js";

// The next `n` numbers from a generator.
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

test("randomInt covers both ends of the range and nothing outside", () => {
	const rng = createRng(3);
	const seen = new Set(
		Array.from({ length: 1000 }, () => randomInt(rng, 1, 3)),
	);
	expect([...seen].sort()).toEqual([1, 2, 3]);
});

test("pick returns an item from the list", () => {
	const items = ["a", "b", "c"];
	expect(items).toContain(pick(createRng(5), items));
});

test("pick from an empty list throws", () => {
	expect(() => pick(createRng(5), [])).toThrow();
});

test("sample returns distinct items from the list", () => {
	const items = [1, 2, 3, 4, 5, 6, 7, 8];
	const result = sample(createRng(9), items, 5);
	expect(result).toHaveLength(5);
	expect(new Set(result).size).toBe(5);
	expect(result.every((n) => items.includes(n))).toBe(true);
});

test("sample does not change the input list", () => {
	const items = [1, 2, 3, 4];
	sample(createRng(9), items, 4);
	expect(items).toEqual([1, 2, 3, 4]);
});

test("sampling more items than exist throws", () => {
	expect(() => sample(createRng(9), [1, 2], 3)).toThrow();
});
