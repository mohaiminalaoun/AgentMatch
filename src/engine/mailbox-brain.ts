// A brain for an outside agent (step 11.11): instead of calling a model, each decision is left in the hosted
// mailbox (`mailbox/`) as a pending request, and the engine waits for the agent to answer on its own schedule.
// It plugs in through `withBrains`, like a different model would.
//
// The engine stays the referee: the answer goes through the same `chatJson` loop as a model's reply, so it is
// validated against the schema and the call's `check` (the disclosure gate included), and a rejected answer goes
// back to the agent as a new request with the problems listed. If no answer comes by the deadline, the call
// fails with a StructuredOutputError, which every call site turns into its safe default (decline, withdraw, no
// picks, keep the version, not confident).
import type { z } from "zod";
import { z as zod } from "zod";
import type {
	PendingRequest,
	StoredAnswer,
} from "../../mailbox/api/_mailbox.js";
import type { ClientStats, LlmClient } from "./client.js";
import type { Config } from "./config.js";
import {
	chatJson,
	StructuredOutputError,
	type ChatOptions,
	type ChatReply,
	type Message,
} from "./llm.js";

export type MailboxSettings = {
	url: string;
	engineKey: string;
};

export type MailboxBrainOptions = {
	// The agent this brain answers for.
	agent: string;
	// How long the agent has to answer each request.
	answerMs: number;
	// How often to check for answers.
	pollMs?: number;
	// Tells requests from different runs apart.
	runId?: string;
	// Swapped in tests.
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => Date;
};

const DEFAULT_POLL_MS = 15_000;

// Thrown inside the brain when the deadline passes; turned into a StructuredOutputError outside `chatJson`'s
// retry loop, so a missed deadline isn't retried.
class MissedDeadline extends Error {}
// Thrown when the request can't be left in the mailbox; also ends in the safe default, not a crashed run.
class MailboxUnavailable extends Error {}

// The prompt an outside agent reads: every message in order, labelled by role, so a retry shows its earlier
// answer and what was wrong with it.
export function promptText(messages: readonly Message[]): string {
	return messages
		.map(({ role, content }) => `### ${role}\n${content}`)
		.join("\n\n");
}

export function createMailboxBrain(
	settings: MailboxSettings,
	{
		agent,
		answerMs,
		pollMs = DEFAULT_POLL_MS,
		runId = Date.now().toString(36),
		fetch: fetchFn = fetch,
		sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now = () => new Date(),
	}: MailboxBrainOptions,
): LlmClient {
	const stats: ClientStats = {
		peakInFlight: 0,
		retries: 0,
		rateLimited: 0,
		requestMs: 0,
	};
	const model = `mailbox:${agent}`;
	let count = 0;

	// Requests waiting for an answer, checked together by one polling loop.
	const waiting = new Map<
		string,
		{
			deadline: Date;
			resolve: (answer: StoredAnswer) => void;
			reject: (error: Error) => void;
		}
	>();
	let polling = false;

	async function engine(path: string, body: unknown): Promise<unknown> {
		const started = performance.now();
		try {
			const response = await fetchFn(new URL(path, settings.url), {
				method: "POST",
				headers: {
					authorization: `Bearer ${settings.engineKey}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			});
			if (!response.ok) {
				throw new Error(`mailbox ${path} answered ${response.status}`);
			}
			return await response.json();
		} finally {
			stats.requestMs += performance.now() - started;
		}
	}

	async function poll(): Promise<void> {
		if (polling) return;
		polling = true;
		try {
			while (waiting.size > 0) {
				await sleep(pollMs);
				const ids = [...waiting.keys()];
				let found: Record<string, StoredAnswer> = {};
				try {
					({ answers: found } = (await engine("/engine/answers", {
						ids,
					})) as { answers: Record<string, StoredAnswer> });
				} catch {
					// A failed check is just a missed poll; the next one tries again.
					stats.retries++;
				}
				const time = now();
				for (const id of ids) {
					const entry = waiting.get(id)!;
					const answer = found[id];
					if (answer) {
						waiting.delete(id);
						entry.resolve(answer);
					} else if (time >= entry.deadline) {
						waiting.delete(id);
						entry.reject(new MissedDeadline());
					}
				}
			}
		} finally {
			polling = false;
		}
	}

	// One round trip through the mailbox: leave the request, then wait for its answer or its deadline.
	async function send(
		messages: readonly Message[],
		replySchema: Record<string, unknown>,
		options: ChatOptions,
	): Promise<ChatReply> {
		count++;
		const deadline = new Date(now().getTime() + answerMs);
		const request: PendingRequest = {
			id: `${runId}-${agent}-${count}`,
			agent,
			kind: options.about?.kind ?? "decision",
			level: options.about?.level ?? 0,
			prompt: promptText(messages),
			replySchema,
			deadline: deadline.toISOString(),
		};
		try {
			await engine("/engine/requests", { requests: [request] });
		} catch (error) {
			throw new MailboxUnavailable((error as Error).message);
		}
		const answered = new Promise<StoredAnswer>((resolve, reject) => {
			waiting.set(request.id, { deadline, resolve, reject });
		});
		stats.peakInFlight = Math.max(stats.peakInFlight, waiting.size);
		void poll();
		const { reply } = await answered;
		const content = JSON.stringify(reply);
		options.onExchange?.({
			messages,
			reply: content,
			usage: undefined,
			model,
		});
		return { content, usage: undefined };
	}

	const brain: LlmClient = {
		chat: () => {
			throw new Error(
				"an outside agent only answers structured requests (chatJson)",
			);
		},
		chatJson: async (messages, schema, options = {}) => {
			const replySchema = zod.toJSONSchema(schema as z.ZodType, {
				io: "input",
				unrepresentable: "any",
			}) as Record<string, unknown>;
			try {
				// `config` is unused: every attempt goes through `send`.
				return await chatJson({} as Config, messages, schema, {
					...options,
					send: (sent, sendOptions) =>
						send(sent, replySchema, sendOptions),
				});
			} catch (error) {
				if (error instanceof MissedDeadline) {
					throw new StructuredOutputError(
						"no answer before the deadline",
						"",
						[
							`${agent} did not answer within ${answerMs / 60_000} minutes`,
						],
					);
				}
				if (error instanceof MailboxUnavailable) {
					throw new StructuredOutputError(
						"the mailbox could not take the request",
						"",
						[error.message],
					);
				}
				throw error;
			}
		},
		stats,
		model,
	};
	return brain;
}
