import { describe, expect, test } from "vitest";
import { withRetry } from "../../src/engine/backoff.js";
import { LlmError } from "../../src/engine/llm.js";

const rateLimited = () =>
	new LlmError("HTTP 429", { status: 429, retryable: true });

// A task that throws each of `errors` in turn, then returns "done".
function failThen(...errors: Error[]) {
	let calls = 0;
	const task = async () => {
		calls++;
		const error = errors[calls - 1];
		if (error) {
			throw error;
		}
		return "done";
	};
	return { task, calls: () => calls };
}

// A sleep that returns instantly and records how long it was asked to wait.
function fakeSleep() {
	const waits: number[] = [];
	return { sleep: async (ms: number) => void waits.push(ms), waits };
}

describe("withRetry", () => {
	test("resends after a retryable error and returns the result", async () => {
		const { task, calls } = failThen(rateLimited(), rateLimited());
		const { sleep } = fakeSleep();
		expect(await withRetry(task, { sleep })).toBe("done");
		expect(calls()).toBe(3);
	});

	test("waits grow exponentially, with jitter inside each ceiling", async () => {
		const { task } = failThen(rateLimited(), rateLimited(), rateLimited());
		const { sleep, waits } = fakeSleep();
		await withRetry(task, { sleep, random: () => 0.5, baseDelayMs: 1000 });
		expect(waits).toEqual([500, 1000, 2000]);
	});

	test("waits never exceed the maximum delay", async () => {
		const { task } = failThen(...Array.from({ length: 5 }, rateLimited));
		const { sleep, waits } = fakeSleep();
		await withRetry(task, {
			sleep,
			random: () => 0.999,
			baseDelayMs: 1000,
			maxDelayMs: 3000,
		});
		expect(Math.max(...waits)).toBeLessThanOrEqual(3000);
		expect(waits.at(-1)).toBe(2997);
	});

	test("the server's Retry-After overrides the backoff", async () => {
		const { task } = failThen(
			new LlmError("HTTP 429", {
				status: 429,
				retryable: true,
				retryAfterMs: 5000,
			}),
		);
		const { sleep, waits } = fakeSleep();
		await withRetry(task, { sleep, random: () => 0.5 });
		expect(waits).toEqual([5000]);
	});

	test("errors that aren't retryable are thrown at once", async () => {
		const { task, calls } = failThen(
			new LlmError("HTTP 401", { status: 401 }),
		);
		const { sleep, waits } = fakeSleep();
		await expect(withRetry(task, { sleep })).rejects.toThrow("HTTP 401");
		expect(calls()).toBe(1);
		expect(waits).toEqual([]);
	});

	test("ordinary errors are never retried", async () => {
		const { task, calls } = failThen(new TypeError("a bug"));
		const { sleep } = fakeSleep();
		await expect(withRetry(task, { sleep })).rejects.toThrow("a bug");
		expect(calls()).toBe(1);
	});

	test("gives up after maxRetries and throws the last error", async () => {
		const { task, calls } = failThen(
			...Array.from({ length: 10 }, rateLimited),
		);
		const { sleep } = fakeSleep();
		await expect(withRetry(task, { sleep, maxRetries: 2 })).rejects.toThrow(
			"HTTP 429",
		);
		expect(calls()).toBe(3);
	});

	test("onRetry hears each retry before its wait", async () => {
		const { task } = failThen(rateLimited(), rateLimited());
		const { sleep } = fakeSleep();
		const seen: number[] = [];
		await withRetry(task, {
			sleep,
			random: () => 0,
			onRetry: ({ retry, error }) => {
				expect(error.status).toBe(429);
				seen.push(retry);
			},
		});
		expect(seen).toEqual([1, 2]);
	});
});
