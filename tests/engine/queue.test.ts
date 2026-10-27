import { describe, expect, test } from "vitest";
import { createRng, randomInt } from "../../src/engine/random.js";
import { createLimiter } from "../../src/engine/queue.js";

// A promise plus the functions that settle it, so a test decides when a task finishes.
function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Lets every pending promise callback run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Wraps tasks to record how many run at once and the order they start in.
function tracker() {
	let running = 0;
	const state = { maxRunning: 0, started: [] as string[] };
	const task = (name: string, done: Promise<void>) => async () => {
		running++;
		state.maxRunning = Math.max(state.maxRunning, running);
		state.started.push(name);
		try {
			await done;
		} finally {
			running--;
		}
	};
	return { state, task };
}

describe("createLimiter", () => {
	test("never runs more than the limit at once", async () => {
		const limiter = createLimiter(3);
		const { state, task } = tracker();
		const gates = Array.from({ length: 10 }, deferred);
		const all = gates.map((g, i) => limiter.run(task(`t${i}`, g.promise)));
		await flush();
		expect(limiter.active).toBe(3);
		expect(limiter.waiting).toBe(7);
		gates.forEach((g) => g.resolve());
		await Promise.all(all);
		expect(state.maxRunning).toBe(3);
		expect(limiter.active).toBe(0);
	});

	test("waiting tasks start in arrival order", async () => {
		const limiter = createLimiter(1);
		const { state, task } = tracker();
		const gates = Array.from({ length: 4 }, deferred);
		const all = gates.map((g, i) => limiter.run(task(`t${i}`, g.promise)));
		for (const g of gates) {
			await flush();
			g.resolve();
		}
		await Promise.all(all);
		expect(state.started).toEqual(["t0", "t1", "t2", "t3"]);
	});

	// A newcomer arriving at just the wrong moment, after A frees its slot but before
	// the already-waiting B wakes up, must not slip in. The gap is one microtask wide,
	// so this tries every arrival time from 0 to 8 steps after A finishes.
	test("a newcomer can't take a slot that's being handed to a waiting task", async () => {
		for (let steps = 0; steps <= 8; steps++) {
			const limiter = createLimiter(1);
			let running = 0;
			let maxRunning = 0;
			const runs: Promise<unknown>[] = [];
			const b = deferred();
			// Counts how many tasks run at once.
			const track = (body: () => Promise<void>) => async () => {
				running++;
				maxRunning = Math.max(maxRunning, running);
				try {
					await body();
				} finally {
					running--;
				}
			};
			// Runs `fn` after `n` microtask steps.
			const after = (n: number, fn: () => void) => {
				let chain = Promise.resolve();
				for (let i = 0; i < n; i++) {
					chain = chain.then(() => {});
				}
				void chain.then(fn);
			};

			runs.push(
				limiter.run(
					track(async () =>
						after(steps, () =>
							runs.push(limiter.run(track(async () => {}))),
						),
					),
				),
			);
			runs.push(limiter.run(track(() => b.promise)));
			await flush();
			expect(maxRunning, `newcomer after ${steps} steps`).toBe(1);
			b.resolve();
			await flush();
			await Promise.all(runs);
		}
	});

	test("a failing task frees its slot and passes its error on", async () => {
		const limiter = createLimiter(1);
		await expect(
			limiter.run(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await limiter.run(async () => "next")).toBe("next");
		expect(limiter.active).toBe(0);
	});

	test("holds the limit under many tasks finishing at random times", async () => {
		const limiter = createLimiter(4);
		const rng = createRng(7);
		let running = 0;
		let maxRunning = 0;
		const sleepRandom = () =>
			new Promise((resolve) => setTimeout(resolve, randomInt(rng, 0, 3)));
		await Promise.all(
			Array.from({ length: 50 }, () =>
				limiter.run(async () => {
					running++;
					maxRunning = Math.max(maxRunning, running);
					await sleepRandom();
					running--;
				}),
			),
		);
		expect(maxRunning).toBe(4);
		expect(limiter.active).toBe(0);
	});

	test("rejects a limit below 1", () => {
		expect(() => createLimiter(0)).toThrow();
		expect(() => createLimiter(1.5)).toThrow();
	});
});
