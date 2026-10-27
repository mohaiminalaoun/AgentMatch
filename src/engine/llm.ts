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

// One round trip: everything sent to the model and the text it replied with.
export type Exchange = {
	messages: readonly Message[];
	reply: string;
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
	const { choices, usage } = parsed.data;
	const content = choices[0]!.message.content;
	onExchange?.({ messages, reply: content });
	return {
		content,
		usage: usage && {
			input: usage.prompt_tokens,
			output: usage.completion_tokens,
			total: usage.total_tokens,
		},
	};
}

// Asks for a JSON reply matching `schema` and validates it; the prompt's format description comes from the same schema.
export async function chatJson<S extends z.ZodType>(
	config: Config,
	messages: readonly Message[],
	schema: S,
	options: ChatOptions = {},
): Promise<{ data: z.output<S>; usage: TokenUsage | undefined }> {
	const format: Message = {
		role: "system",
		content: [
			"Reply with one JSON object and nothing else: no prose, no markdown.",
			"It must match this JSON Schema:",
			JSON.stringify(z.toJSONSchema(schema)),
		].join("\n"),
	};
	const reply = await chat(config, [format, ...messages], options);

	let json: unknown;
	try {
		json = JSON.parse(extractJson(reply.content));
	} catch (error) {
		throw new StructuredOutputError(
			"reply was not valid JSON",
			reply.content,
			[(error as Error).message],
		);
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		throw new StructuredOutputError(
			"reply did not match the schema",
			reply.content,
			parsed.error.issues.map(
				(issue) =>
					`${issue.path.join(".") || "(root)"}: ${issue.message}`,
			),
		);
	}
	return { data: parsed.data, usage: reply.usage };
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
