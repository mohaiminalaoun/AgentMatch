import type { z } from "zod";
import { withRetry, type RetryOptions } from "./backoff.js";
import type { Config } from "./config.js";
import type { RunEvent } from "./events.js";
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
	// The model every call uses, for labelling logs.
	readonly model: string;
	// Agents that think with a different client than this one, by id (see `withBrains`).
	readonly brains?: Readonly<Record<string, LlmClient>>;
};

// The client that answers for agent `id`: its own brain if it has one, otherwise the shared client.
// Every model call an agent makes goes through this, so each brain only ever answers for its own agent.
export function brainOf(client: LlmClient, id: string): LlmClient {
	return client.brains?.[id] ?? client;
}

// The shared client, with some agents answered by other clients instead, e.g. another model,
// or later an outside agent. The engine stays the referee either way: whoever answers, replies are
// validated and gate-checked exactly as before.
export function withBrains(
	client: LlmClient,
	brains: Readonly<Record<string, LlmClient>>,
): LlmClient {
	return { ...client, brains: { ...client.brains, ...brains } };
}

// The run event recording which agents have a brain of their own, and what it is (its `model`: a model id, or
// "mailbox:<name>" for an outside agent), so logs and the UI can mark them. None if every agent shares one.
export function brainsEvent(client: LlmClient): RunEvent | undefined {
	const entries = Object.entries(client.brains ?? {});
	return entries.length > 0
		? {
				type: "brains",
				agents: Object.fromEntries(
					entries.map(([id, brain]) => [id, brain.model]),
				),
			}
		: undefined;
}

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
		model: config.model,
	};
}
