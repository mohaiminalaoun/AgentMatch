import { describe, expect, test } from "vitest";
import type { Config } from "../../src/engine/config.js";
import {
	chat,
	chatJson,
	formatExchange,
	LlmError,
	type Exchange,
	StructuredOutputError,
	type Message,
} from "../../src/engine/llm.js";
import { Decision } from "../../src/engine/proposal.js";

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

// A fake server whose model replies with `content`.
function replyWith(content: string) {
	return fakeFetch({
		choices: [{ message: { role: "assistant", content } }],
		usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
	});
}

// The StructuredOutputError chatJson rejects with when the model replies `content`.
async function structuredErrorFor(
	content: string,
): Promise<StructuredOutputError> {
	const { fn } = replyWith(content);
	try {
		await chatJson(config, messages, Decision, { fetch: fn });
	} catch (error) {
		expect(error).toBeInstanceOf(StructuredOutputError);
		return error as StructuredOutputError;
	}
	throw new Error("expected chatJson to fail");
}

describe("chatJson", () => {
	test("returns validated data and usage for clean JSON", async () => {
		const { fn } = replyWith(
			'{"decision": "decline", "reason": "Not a fit."}',
		);
		const result = await chatJson(config, messages, Decision, {
			fetch: fn,
		});
		expect(result.data).toEqual({
			decision: "decline",
			reason: "Not a fit.",
		});
		expect(result.usage).toEqual({ input: 50, output: 10, total: 60 });
	});

	test("tolerates markdown fences and chatter around the JSON", async () => {
		const content = [
			"Sure! Here's my answer:",
			"```json",
			'{"decision": "counter", "pitch": "A climate platform", "rolesNeeded": ["backend"]}',
			"```",
			"Let me know if you need anything else.",
		].join("\n");
		const { fn } = replyWith(content);
		const { data } = await chatJson(config, messages, Decision, {
			fetch: fn,
		});
		expect(data).toEqual({
			decision: "counter",
			pitch: "A climate platform",
			rolesNeeded: ["backend"],
		});
	});

	test("puts a JSON Schema built from the zod schema in the prompt", async () => {
		const { fn, calls } = replyWith('{"decision": "accept"}');
		await chatJson(config, messages, Decision, { fetch: fn });
		const sent = JSON.parse(calls[0]!.init.body as string).messages;
		expect(sent[0].role).toBe("system");
		expect(sent[0].content).toContain('"const":"counter"');
		expect(sent[0].content).toContain('"rolesNeeded"');
		expect(sent.slice(1)).toEqual(messages);
	});

	test("invalid JSON keeps the raw reply", async () => {
		const raw = '{"decision": "accept",}';
		const error = await structuredErrorFor(raw);
		expect(error.message).toContain("not valid JSON");
		expect(error.raw).toBe(raw);
		expect(error.problems).toHaveLength(1);
	});

	test("a reply with no JSON at all fails", async () => {
		const error = await structuredErrorFor("I'd rather not say.");
		expect(error.message).toContain("not valid JSON");
	});

	test("a wrong decision value is reported", async () => {
		const error = await structuredErrorFor('{"decision": "Counter"}');
		expect(error.message).toContain("did not match the schema");
		expect(error.problems.join(" ")).toContain("decision");
	});

	test("a counter without its terms lists each missing field", async () => {
		const error = await structuredErrorFor('{"decision": "counter"}');
		const problems = error.problems.join(" ");
		expect(problems).toContain("pitch");
		expect(problems).toContain("rolesNeeded");
	});

	test("a renamed field is reported, not silently dropped", async () => {
		const error = await structuredErrorFor(
			'{"decision": "counter", "pitch": "A climate platform", "roles": ["backend"]}',
		);
		expect(error.problems.join(" ")).toContain("rolesNeeded");
	});
});

describe("onExchange", () => {
	test("chat reports the messages sent and the raw reply", async () => {
		const { fn } = fakeFetch(goodReply);
		const seen: Exchange[] = [];
		await chat(config, messages, {
			fetch: fn,
			onExchange: (e) => seen.push(e),
		});
		expect(seen).toEqual([
			{
				messages,
				reply: "Hello!",
				usage: { input: 10, output: 2, total: 12 },
			},
		]);
	});

	test("chatJson's exchange includes its format instructions", async () => {
		const { fn } = replyWith('{"decision": "accept"}');
		const seen: Exchange[] = [];
		await chatJson(config, messages, Decision, {
			fetch: fn,
			onExchange: (e) => seen.push(e),
		});
		expect(seen[0]!.messages[0]!.content).toContain("JSON Schema");
	});

	test("an invalid reply is still reported before validation fails", async () => {
		const { fn } = replyWith('{"decision": "maybe"}');
		const seen: Exchange[] = [];
		await expect(
			chatJson(config, messages, Decision, {
				fetch: fn,
				onExchange: (e) => seen.push(e),
			}),
		).rejects.toThrow(StructuredOutputError);
		expect(seen[0]!.reply).toBe('{"decision": "maybe"}');
	});

	test("failed requests report nothing", async () => {
		const { fn } = fakeFetch({ error: "bad key" }, 401);
		const seen: Exchange[] = [];
		await expect(
			chat(config, messages, {
				fetch: fn,
				onExchange: (e) => seen.push(e),
			}),
		).rejects.toThrow(LlmError);
		expect(seen).toEqual([]);
	});
});

describe("formatExchange", () => {
	test("shows every message then the reply, labeled by role", () => {
		const text = formatExchange({
			messages: [
				{ role: "system", content: "Be brief." },
				{ role: "user", content: "Hi" },
			],
			reply: "Hello!",
			usage: undefined,
		});
		expect(text).toBe(
			"── system ──\nBe brief.\n\n── user ──\nHi\n\n── assistant ──\nHello!",
		);
	});
});

// A fake server whose model gives each of `contents` in turn, one per request.
function replySequence(...contents: string[]) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fn = async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		const content = contents[Math.min(calls.length, contents.length) - 1]!;
		return new Response(
			JSON.stringify({
				choices: [{ message: { role: "assistant", content } }],
				usage: {
					prompt_tokens: 50,
					completion_tokens: 10,
					total_tokens: 60,
				},
			}),
		);
	};
	return { fn: fn as typeof fetch, calls };
}

// The messages sent in the nth request (0-based) recorded by a fake fetch.
function sentMessages(calls: { init: RequestInit }[], n: number): Message[] {
	return JSON.parse(calls[n]!.init.body as string).messages;
}

describe("chatJson retries", () => {
	const bad = '{"decision": "Counter"}';
	const good = '{"decision": "accept"}';

	test("an invalid reply is corrected on the next attempt", async () => {
		const { fn, calls } = replySequence(bad, good);
		const result = await chatJson(config, messages, Decision, {
			fetch: fn,
		});
		expect(result.data).toEqual({ decision: "accept" });
		expect(result.attempts).toBe(2);
		expect(calls).toHaveLength(2);
	});

	test("the retry shows the model its bad reply and the problems", async () => {
		const { fn, calls } = replySequence(bad, good);
		await chatJson(config, messages, Decision, { fetch: fn });
		const second = sentMessages(calls, 1);
		const [assistant, feedback] = second.slice(-2);
		expect(assistant).toEqual({ role: "assistant", content: bad });
		expect(feedback!.role).toBe("user");
		expect(feedback!.content).toContain("Your reply was invalid");
		expect(feedback!.content).toContain("- decision:");
		expect(second.slice(0, -2)).toEqual(sentMessages(calls, 0));
	});

	test("usage is the total across attempts", async () => {
		const { fn } = replySequence(bad, good);
		const { usage } = await chatJson(config, messages, Decision, {
			fetch: fn,
		});
		expect(usage).toEqual({ input: 100, output: 20, total: 120 });
	});

	test("gives up after maxAttempts and throws the last problem", async () => {
		const { fn, calls } = replySequence(bad);
		await expect(
			chatJson(config, messages, Decision, { fetch: fn }),
		).rejects.toThrow(StructuredOutputError);
		expect(calls).toHaveLength(3);
	});

	test("maxAttempts 1 turns retries off", async () => {
		const { fn, calls } = replySequence(bad, good);
		await expect(
			chatJson(config, messages, Decision, { fetch: fn, maxAttempts: 1 }),
		).rejects.toThrow(StructuredOutputError);
		expect(calls).toHaveLength(1);
	});

	test("HTTP errors are never retried", async () => {
		const { fn, calls } = fakeFetch({ error: "bad key" }, 401);
		await expect(
			chatJson(config, messages, Decision, { fetch: fn }),
		).rejects.toThrow(LlmError);
		expect(calls).toHaveLength(1);
	});

	test("onRetry hears about each failed attempt that gets another try", async () => {
		const { fn } = replySequence(bad, bad, good);
		const retries: number[] = [];
		await chatJson(config, messages, Decision, {
			fetch: fn,
			onRetry: (error, attempt) => {
				expect(error).toBeInstanceOf(StructuredOutputError);
				retries.push(attempt);
			},
		});
		expect(retries).toEqual([1, 2]);
	});

	test("a logged exchange isn't changed by later retries", async () => {
		const { fn } = replySequence(bad, good);
		const seen: Exchange[] = [];
		await chatJson(config, messages, Decision, {
			fetch: fn,
			onExchange: (e) => seen.push(e),
		});
		expect(seen).toHaveLength(2);
		expect(seen[0]!.messages).toHaveLength(messages.length + 1);
		expect(seen[1]!.messages).toHaveLength(messages.length + 3);
	});
});
