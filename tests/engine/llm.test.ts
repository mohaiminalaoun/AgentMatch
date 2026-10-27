import { describe, expect, test } from "vitest";
import type { Config } from "../../src/engine/config.js";
import { chat, LlmError, type Message } from "../../src/engine/llm.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1/",
	apiKey: "test-key-123",
	model: "test-model",
};

const messages: Message[] = [{ role: "user", content: "Say hello." }];

const goodReply = {
	choices: [{ message: { role: "assistant", content: "Hello!" } }],
	usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
};

// A stand-in for fetch that records each request and answers with `body` and `status`.
function fakeFetch(body: unknown, status = 200) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fn = async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		const text = typeof body === "string" ? body : JSON.stringify(body);
		return new Response(text, { status });
	};
	return { fn: fn as typeof fetch, calls };
}

// The error `chat` rejects with for a fake server answering `body` and `status`.
async function errorFor(body: unknown, status: number): Promise<LlmError> {
	const { fn } = fakeFetch(body, status);
	try {
		await chat(config, messages, { fetch: fn });
	} catch (error) {
		return error as LlmError;
	}
	throw new Error("expected chat to fail");
}

describe("chat", () => {
	test("posts to the chat completions endpoint with the key and model", async () => {
		const { fn, calls } = fakeFetch(goodReply);
		await chat(config, messages, { fetch: fn });

		expect(calls).toHaveLength(1);
		const { url, init } = calls[0]!;
		expect(url).toBe("https://llm.example.com/v1/chat/completions");
		expect(init.method).toBe("POST");
		expect(new Headers(init.headers).get("Authorization")).toBe(
			"Bearer test-key-123",
		);
		expect(JSON.parse(init.body as string)).toEqual({
			model: "test-model",
			messages,
		});
	});

	test("returns the reply text and token usage", async () => {
		const { fn } = fakeFetch(goodReply);
		expect(await chat(config, messages, { fetch: fn })).toEqual({
			content: "Hello!",
			usage: { input: 10, output: 2, total: 12 },
		});
	});

	test("works when the provider doesn't report usage", async () => {
		const { fn } = fakeFetch({ choices: goodReply.choices });
		const reply = await chat(config, messages, { fetch: fn });
		expect(reply.usage).toBeUndefined();
	});

	test("a 401 points at the API key and keeps the status", async () => {
		const error = await errorFor({ error: "bad key" }, 401);
		expect(error).toBeInstanceOf(LlmError);
		expect(error.status).toBe(401);
		expect(error.message).toContain("check LLM_API_KEY");
	});

	test("a 404 points at the model and URL", async () => {
		const error = await errorFor({ error: "no such model" }, 404);
		expect(error.message).toContain("check LLM_MODEL and LLM_BASE_URL");
	});

	test("a 429 is reported as rate limiting", async () => {
		const error = await errorFor({ error: "slow down" }, 429);
		expect(error.status).toBe(429);
		expect(error.message).toContain("rate limited");
	});

	test("the key is redacted if the server echoes it back", async () => {
		const error = await errorFor("invalid key test-key-123", 401);
		expect(error.message).not.toContain("test-key-123");
		expect(error.message).toContain("[redacted]");
	});

	test("a malformed reply fails clearly", async () => {
		const error = await errorFor({ choices: [] }, 200);
		expect(error).toBeInstanceOf(LlmError);
		expect(error.message).toContain("unexpected response shape");
	});

	test("a network failure names the base URL", async () => {
		const failing = (async () => {
			throw new TypeError("fetch failed");
		}) as typeof fetch;
		await expect(
			chat(config, messages, { fetch: failing }),
		).rejects.toThrow("check LLM_BASE_URL");
	});

	test("every request carries an abort signal, even by default", async () => {
		const { fn, calls } = fakeFetch(goodReply);
		await chat(config, messages, { fetch: fn });
		expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
	});

	test("a provider that never answers times out", async () => {
		// Like a real server that hangs: it only gives up when the signal fires.
		const hanging = ((_url: unknown, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(init.signal!.reason),
				);
			})) as typeof fetch;
		const started = performance.now();
		await expect(
			chat(config, messages, { fetch: hanging, timeoutMs: 20 }),
		).rejects.toThrow("no reply within 0.02s");
		expect(performance.now() - started).toBeLessThan(1000);
	});
});
