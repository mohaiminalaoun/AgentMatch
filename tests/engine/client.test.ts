import { describe, expect, test } from "vitest";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import { Decision } from "../../src/engine/proposal.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 3,
};

type FakeResponse = {
	status?: number;
	content?: string;
	headers?: Record<string, string>;
};

// A fake server that answers each request with the next of `responses` (repeating the last),
// after `delayMs`, and records the most requests it ever had open at once.
function fakeServer(responses: FakeResponse[], delayMs = 0) {
	let calls = 0;
	let open = 0;
	const seen = { maxOpen: 0, calls: () => calls };
	const fetch = (async () => {
		calls++;
		open++;
		seen.maxOpen = Math.max(seen.maxOpen, open);
		const {
			status = 200,
			content = "OK",
			headers = {},
		} = responses[Math.min(calls, responses.length) - 1]!;
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		open--;
		const body =
			status === 200
				? JSON.stringify({
						choices: [{ message: { role: "assistant", content } }],
						usage: {
							prompt_tokens: 5,
							completion_tokens: 1,
							total_tokens: 6,
						},
					})
				: JSON.stringify({ error: "nope" });
		return new Response(body, { status, headers });
	}) as typeof globalThis.fetch;
	return { fetch, seen };
}

const instantRetry = { sleep: async () => {}, random: () => 0 };
const messages = [{ role: "user" as const, content: "Say OK" }];

describe("createLlmClient", () => {
	test("keeps at most maxConcurrency requests open", async () => {
		const { fetch, seen } = fakeServer([{}], 5);
		const client = createLlmClient(config, { fetch, retry: instantRetry });
		const replies = await Promise.all(
			Array.from({ length: 10 }, () => client.chat(messages)),
		);
		expect(replies.every((r) => r.content === "OK")).toBe(true);
		expect(seen.maxOpen).toBe(3);
		expect(client.stats.peakInFlight).toBe(3);
	});

	test("a 429 is retried and counted, then succeeds", async () => {
		const { fetch, seen } = fakeServer([
			{ status: 429 },
			{ status: 429 },
			{},
		]);
		const client = createLlmClient(config, { fetch, retry: instantRetry });
		const reply = await client.chat(messages);
		expect(reply.content).toBe("OK");
		expect(seen.calls()).toBe(3);
		expect(client.stats.retries).toBe(2);
		expect(client.stats.rateLimited).toBe(2);
	});

	test("the server's Retry-After header sets the wait", async () => {
		const { fetch } = fakeServer([
			{ status: 429, headers: { "Retry-After": "3" } },
			{},
		]);
		const waits: number[] = [];
		const client = createLlmClient(config, {
			fetch,
			retry: { sleep: async (ms) => void waits.push(ms) },
		});
		await client.chat(messages);
		expect(waits).toEqual([3000]);
	});

	test("a 500 is retried but not counted as rate limiting", async () => {
		const { fetch } = fakeServer([{ status: 500 }, {}]);
		const client = createLlmClient(config, { fetch, retry: instantRetry });
		await client.chat(messages);
		expect(client.stats.retries).toBe(1);
		expect(client.stats.rateLimited).toBe(0);
	});

	test("a 401 fails at once without retrying", async () => {
		const { fetch, seen } = fakeServer([{ status: 401 }]);
		const client = createLlmClient(config, { fetch, retry: instantRetry });
		await expect(client.chat(messages)).rejects.toThrow("HTTP 401");
		expect(seen.calls()).toBe(1);
		expect(client.stats.retries).toBe(0);
	});

	test("chatJson's content retries also go through the client", async () => {
		const { fetch, seen } = fakeServer([
			{ status: 429 },
			{ content: '{"decision": "maybe"}' },
			{ content: '{"decision": "accept"}' },
		]);
		const client = createLlmClient(config, { fetch, retry: instantRetry });
		const { data, attempts } = await client.chatJson(messages, Decision);
		expect(data).toEqual({ decision: "accept" });
		expect(attempts).toBe(2);
		expect(seen.calls()).toBe(3);
		expect(client.stats.rateLimited).toBe(1);
	});

	test("time spent in requests is added up", async () => {
		const { fetch } = fakeServer([{}], 5);
		const client = createLlmClient(config, { fetch, retry: instantRetry });
		await client.chat(messages);
		expect(client.stats.requestMs).toBeGreaterThan(0);
	});
});
