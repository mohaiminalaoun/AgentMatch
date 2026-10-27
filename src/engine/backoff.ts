import { LlmError } from "./llm.js";

export type RetryOptions = {
	// Extra tries after the first one fails.
	maxRetries?: number;
	// The first backoff ceiling; it doubles after each failure.
	baseDelayMs?: number;
	// The highest backoff ceiling, however many failures there have been.
	maxDelayMs?: number;
	// How to wait; tests swap in a fake that returns instantly.
	sleep?: (ms: number) => Promise<void>;
	// A number in [0, 1) for jitter, like Math.random or a seeded Rng.
	random?: () => number;
	// Called before each wait, e.g. to count retries.
	onRetry?: (info: {
		retry: number;
		delayMs: number;
		error: LlmError;
	}) => void;
};

const realSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

// Runs `task`, and if it fails with a retryable LlmError, waits and runs it again.
// Waits grow exponentially with random jitter, unless the server said how long to wait.
export async function withRetry<T>(
	task: () => Promise<T>,
	{
		maxRetries = 5,
		baseDelayMs = 1_000,
		maxDelayMs = 30_000,
		sleep = realSleep,
		random = Math.random,
		onRetry,
	}: RetryOptions = {},
): Promise<T> {
	for (let retry = 1; ; retry++) {
		try {
			return await task();
		} catch (error) {
			if (
				!(error instanceof LlmError) ||
				!error.retryable ||
				retry > maxRetries
			) {
				throw error;
			}
			const ceiling = Math.min(
				maxDelayMs,
				baseDelayMs * 2 ** (retry - 1),
			);
			// Full jitter: anywhere up to the ceiling, so many callers that failed
			// together don't all retry at the same instant.
			const delayMs =
				error.retryAfterMs ?? Math.round(random() * ceiling);
			onRetry?.({ retry, delayMs, error });
			await sleep(delayMs);
		}
	}
}
