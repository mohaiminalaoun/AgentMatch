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

export type ChatOptions = {
	// Fail rather than hang forever if the provider never answers.
	timeoutMs?: number;
	// Swapped for a fake in tests, so they never touch the network.
	fetch?: typeof fetch;
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
	return {
		content: choices[0]!.message.content,
		usage: usage && {
			input: usage.prompt_tokens,
			output: usage.completion_tokens,
			total: usage.total_tokens,
		},
	};
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
