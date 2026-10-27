import { z } from "zod";
import type { Config } from "./config.js";

export type Message = {
	role: "system" | "user" | "assistant";
	content: string;
};

export type TokenUsage = { input: number; output: number; total: number };

export type ChatReply = {
	content: string;
	usage: TokenUsage | undefined;
};

// An LLM call that failed; `status` is the HTTP status when the server answered.
export class LlmError extends Error {
	constructor(
		message: string,
		readonly status: number | undefined = undefined,
	) {
		super(message);
		this.name = "LlmError";
	}
}

// A reply that wasn't the JSON we asked for; keeps the raw text and every problem so a retry can quote them.
export class StructuredOutputError extends LlmError {
	constructor(
		message: string,
		readonly raw: string,
		readonly problems: string[],
	) {
		super(message);
		this.name = "StructuredOutputError";
	}
}

// One round trip: everything sent to the model, the text it replied with, and what it cost.
export type Exchange = {
	messages: readonly Message[];
	reply: string;
	usage: TokenUsage | undefined;
};

export type ChatOptions = {
	// Fail rather than hang forever if the provider never answers.
	timeoutMs?: number;
	// Swapped for a fake in tests, so they never touch the network.
	fetch?: typeof fetch;
	// Called after every successful call, e.g. to print or log the conversation.
	onExchange?: (exchange: Exchange) => void;
};

const DEFAULT_TIMEOUT_MS = 60_000;

// The parts of an OpenAI-compatible chat response this code relies on.
const ChatResponse = z.object({
	choices: z
		.array(z.object({ message: z.object({ content: z.string() }) }))
		.min(1),
	usage: z
		.object({
			prompt_tokens: z.number(),
			completion_tokens: z.number(),
			total_tokens: z.number(),
		})
		.optional(),
});

// Sends `messages` to the configured model and returns its reply.
export async function chat(
	config: Config,
	messages: readonly Message[],
	{
		timeoutMs = DEFAULT_TIMEOUT_MS,
		fetch: fetchFn = fetch,
		onExchange,
	}: ChatOptions = {},
): Promise<ChatReply> {
	const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
	let response: Response;
	try {
		response = await fetchFn(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ model: config.model, messages }),
			// Fires by itself after `timeoutMs`, making fetch cancel the request and reject.
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		if ((error as Error).name === "TimeoutError") {
			throw new LlmError(`no reply within ${timeoutMs / 1000}s`);
		}
		throw new LlmError(
			`could not reach ${url}; check LLM_BASE_URL and your connection`,
		);
	}

	if (!response.ok) {
		const body = (await response.text())
			.replaceAll(config.apiKey, "[redacted]")
			.slice(0, 300);
		throw new LlmError(
			`HTTP ${response.status}: ${hintFor(response.status)}\n${body}`,
			response.status,
		);
	}

	const parsed = ChatResponse.safeParse(await response.json());
	if (!parsed.success) {
		throw new LlmError(
			`unexpected response shape: ${parsed.error.issues[0]?.message}`,
		);
	}
	const { choices, usage: rawUsage } = parsed.data;
	const content = choices[0]!.message.content;
	const usage = rawUsage && {
		input: rawUsage.prompt_tokens,
		output: rawUsage.completion_tokens,
		total: rawUsage.total_tokens,
	};
	onExchange?.({ messages, reply: content, usage });
	return { content, usage };
}

export type ChatJsonOptions = ChatOptions & {
	// Tries in total, counting the first; only invalid output is retried, never HTTP or network errors.
	maxAttempts?: number;
	// Called when a reply is invalid and another attempt follows, e.g. to count failures.
	onRetry?: (error: StructuredOutputError, attempt: number) => void;
};

const DEFAULT_MAX_ATTEMPTS = 3;

// Asks for a JSON reply matching `schema` and validates it; the prompt's format description comes from the same schema.
// An invalid reply is shown back to the model with the problems, and it tries again.
export async function chatJson<S extends z.ZodType>(
	config: Config,
	messages: readonly Message[],
	schema: S,
	{
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		onRetry,
		...options
	}: ChatJsonOptions = {},
): Promise<{
	data: z.output<S>;
	usage: TokenUsage | undefined;
	attempts: number;
}> {
	const format: Message = {
		role: "system",
		content: [
			"Reply with one JSON object and nothing else: no prose, no markdown.",
			"It must match this JSON Schema:",
			JSON.stringify(z.toJSONSchema(schema)),
		].join("\n"),
	};
	const conversation: Message[] = [format, ...messages];
	let usage: TokenUsage | undefined;
	for (let attempt = 1; ; attempt++) {
		// A copy, so a logged exchange doesn't change when feedback is appended below.
		const reply = await chat(config, [...conversation], options);
		usage = addUsage(usage, reply.usage);
		try {
			return {
				data: parseReply(reply.content, schema),
				usage,
				attempts: attempt,
			};
		} catch (error) {
			if (
				!(error instanceof StructuredOutputError) ||
				attempt >= maxAttempts
			) {
				throw error;
			}
			onRetry?.(error, attempt);
			conversation.push(
				{ role: "assistant", content: reply.content },
				{ role: "user", content: feedbackFor(error) },
			);
		}
	}
}

// Extracts the JSON object from a reply and validates it, or throws a StructuredOutputError saying what's wrong.
function parseReply<S extends z.ZodType>(
	content: string,
	schema: S,
): z.output<S> {
	let json: unknown;
	try {
		json = JSON.parse(extractJson(content));
	} catch (error) {
		throw new StructuredOutputError("reply was not valid JSON", content, [
			(error as Error).message,
		]);
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		throw new StructuredOutputError(
			"reply did not match the schema",
			content,
			parsed.error.issues.map(
				(issue) =>
					`${issue.path.join(".") || "(root)"}: ${issue.message}`,
			),
		);
	}
	return parsed.data;
}

// The correction message sent after an invalid reply, listing every problem.
function feedbackFor(error: StructuredOutputError): string {
	return [
		`Your reply was invalid (${error.message}):`,
		...error.problems.map((problem) => `- ${problem}`),
		"Reply again with only the corrected JSON object.",
	].join("\n");
}

// Sums token usage across attempts; unknown if either side is unknown and the other is missing.
function addUsage(
	a: TokenUsage | undefined,
	b: TokenUsage | undefined,
): TokenUsage | undefined {
	if (!a || !b) {
		return a ?? b;
	}
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		total: a.total + b.total,
	};
}

// The text from the first `{` to the last `}`, which drops chatter and markdown fences around a JSON object.
function extractJson(text: string): string {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end < start) {
		throw new Error("no JSON object found");
	}
	return text.slice(start, end + 1);
}

// Lays out an exchange as a readable transcript, one block per message.
export function formatExchange({ messages, reply }: Exchange): string {
	return [...messages, { role: "assistant", content: reply }]
		.map(({ role, content }) => `── ${role} ──\n${content}`)
		.join("\n\n");
}

// What an HTTP error status most likely means for this project's settings.
function hintFor(status: number): string {
	if (status === 401 || status === 403) {
		return "the provider rejected the key; check LLM_API_KEY";
	}
	if (status === 404) {
		return "not found; check LLM_MODEL and LLM_BASE_URL";
	}
	if (status === 429) {
		return "rate limited; slow down or retry later";
	}
	if (status >= 500) {
		return "the provider had an error; try again";
	}
	return "the request was rejected";
}
