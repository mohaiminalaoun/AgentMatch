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
import type { MailboxDiagnostic } from "./events.js";
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
	// Optional wake notification; the full prompt stays in the authenticated mailbox.
	webhook?: { url: string; key: string };
	onDiagnostic?: (event: MailboxDiagnostic) => void;
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

// Put before every prompt an outside agent reads: the prompts are written for the arena's own agents, whose
// whole knowledge of their human is the profile in them, while an outside agent knows its human far better.
export const OUTSIDE_PREFACE = [
	"You are answering for your human in Agent Match, through the arena's mailbox. The prompt below is the one the arena's own agents get.",
	"Where it shows your human's profile, that is the profile you declared: the arena shares those values level by level and checks what you send against them. Use everything else you know about your human in your judgment too.",
	"The disclosure rules below apply to everything you send, whatever its source. Your rationale goes only to the arena operator's log, never to another agent.",
].join("\n");

// The prompt an outside agent reads: the preface, then every message in order, labelled by role, so a retry
// shows its earlier answer and what was wrong with it.
export function promptText(messages: readonly Message[]): string {
	return [
		OUTSIDE_PREFACE,
		...messages.map(({ role, content }) => `### ${role}\n${content}`),
	].join("\n\n");
}

export function createMailboxBrain(
	settings: MailboxSettings,
	{
		agent,
		answerMs,
		pollMs = DEFAULT_POLL_MS,
		onDiagnostic,
		webhook,
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
			onPollError: () => void;
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
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
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
					for (const id of ids) waiting.get(id)?.onPollError();
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
		track: (request: PendingRequest) => void,
		emit: (
			status: MailboxDiagnostic["status"],
			reason?: MailboxDiagnostic["reason"],
		) => void,
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
		track(request);
		emit("pending");
		try {
			await engine("/engine/requests", { requests: [request] });
		} catch (error) {
			throw new MailboxUnavailable((error as Error).message);
		}
		if (webhook) {
			try {
				const response = await fetchFn(webhook.url, {
					method: "POST",
					redirect: "error",
					signal: AbortSignal.timeout(30_000),
					headers: {
						authorization: `Bearer ${webhook.key}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({ request_id: request.id }),
				});
				if (!response.ok) throw new Error("notification rejected");
				emit("notified");
			} catch {
				// Delivery may have succeeded despite a timeout. Never retry a wake blindly.
				// Keep waiting: a notification failure is not an agent's decline.
				emit("notification_failed", "webhook_error");
			}
		}
		const answered = new Promise<StoredAnswer>((resolve, reject) => {
			waiting.set(request.id, {
				deadline,
				resolve,
				reject,
				onPollError: () => emit("poll_error", "mailbox_error"),
			});
		});
		stats.peakInFlight = Math.max(stats.peakInFlight, waiting.size);
		void poll();
		const { reply } = await answered;
		emit("answered");
		const content = JSON.stringify(reply);
		options.onExchange?.({
			messages,
			reply: content,
			usage: undefined,
			model,
			requestId: request.id,
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
			const started = now().getTime();
			let current: PendingRequest | undefined;
			let attempt = 0;
			const emit = (
				status: MailboxDiagnostic["status"],
				reason?: MailboxDiagnostic["reason"],
			) => {
				if (!current) return;
				onDiagnostic?.({
					type: "mailbox",
					time: now().toISOString(),
					agent,
					requestId: current.id,
					kind: current.kind,
					level: current.level,
					attempt,
					elapsedMs: Math.max(0, now().getTime() - started),
					status,
					...(reason ? { reason } : {}),
				});
			};
			const category = (
				error: StructuredOutputError,
			): MailboxDiagnostic["reason"] =>
				error.kind === "rule"
					? error.problems.some((p) =>
							/which isn't public|which you may not share at level/i.test(
								p,
							),
						)
						? "disclosure_rejection"
						: "rule_rejection"
					: error.message.includes("not valid JSON")
						? "invalid_json"
						: "schema_failure";
			const replySchema = zod.toJSONSchema(schema as z.ZodType, {
				io: "input",
				unrepresentable: "any",
			}) as Record<string, unknown>;
			try {
				// `config` is unused: every attempt goes through `send`.
				const result = await chatJson({} as Config, messages, schema, {
					...options,
					send: (sent, sendOptions) =>
						send(
							sent,
							replySchema,
							sendOptions,
							(request) => {
								current = request;
								attempt++;
							},
							emit,
						),
					onRetry: (error, n) => {
						emit("retry", category(error));
						options.onRetry?.(error, n);
					},
				});
				emit("completed");
				return result;
			} catch (error) {
				if (!(
					error instanceof MissedDeadline ||
					error instanceof MailboxUnavailable ||
					error instanceof StructuredOutputError
				))
					throw error;
				emit(
					"fallback",
					error instanceof MissedDeadline
						? "timeout"
						: error instanceof MailboxUnavailable
							? "mailbox_error"
							: error instanceof StructuredOutputError
								? category(error)
								: "mailbox_error",
				);
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
