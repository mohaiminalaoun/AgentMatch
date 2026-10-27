import type { z } from "zod";
import { withRetry, type RetryOptions } from "./backoff.js";
import type { Config } from "./config.js";
import {
	chat,
	chatJson,
	type ChatJsonOptions,
	type ChatOptions,
	type ChatReply,
	type Message,
	type TokenUsage,
} from "./llm.js";
import { createLimiter } from "./queue.js";

// Running totals, e.g. for a load test's report.
export type ClientStats = {
	peakInFlight: number;
	retries: number;
	rateLimited: number;
	// Time spent inside HTTP requests, summed over all of them.
	requestMs: number;
};

export type LlmClient = {
	chat: (
		messages: readonly Message[],
		options?: ChatOptions,
	) => Promise<ChatReply>;
	chatJson: <S extends z.ZodType>(
		messages: readonly Message[],
		schema: S,
		options?: ChatJsonOptions<z.output<S>>,
	) => Promise<{
		data: z.output<S>;
		usage: TokenUsage | undefined;
		attempts: number;
	}>;
	readonly stats: ClientStats;
};

export type ClientOptions = {
	retry?: RetryOptions;
	// Swapped for a fake in tests.
	fetch?: typeof fetch;
};

// One shared client for all agents: every call waits for a slot (at most `config.maxConcurrency`
// in flight) and is resent with backoff on rate limits and server errors.
export function createLlmClient(
	config: Config,
	{ retry = {}, fetch }: ClientOptions = {},
): LlmClient {
	const limiter = createLimiter(config.maxConcurrency);
	const stats: ClientStats = {
		peakInFlight: 0,
		retries: 0,
		rateLimited: 0,
		requestMs: 0,
	};

	const queuedChat = (
		messages: readonly Message[],
		options: ChatOptions = {},
	): Promise<ChatReply> =>
		// The slot is held through backoff waits, so a rate-limited client naturally slows down.
		limiter.run(() => {
			stats.peakInFlight = Math.max(stats.peakInFlight, limiter.active);
			return withRetry(
				async () => {
					const started = performance.now();
					try {
						return await chat(config, messages, {
							...(fetch && { fetch }),
							...options,
						});
					} finally {
						stats.requestMs += performance.now() - started;
					}
				},
				{
					...retry,
					onRetry: (info) => {
						stats.retries++;
						if (info.error.status === 429) {
							stats.rateLimited++;
						}
						retry.onRetry?.(info);
					},
				},
			);
		});

	return {
		chat: queuedChat,
		// Content retries (bad JSON) go back through the queue too, so they can't skip the limit.
		chatJson: (messages, schema, options = {}) =>
			chatJson(config, messages, schema, {
				...options,
				send: queuedChat,
			}),
		stats,
	};
}
