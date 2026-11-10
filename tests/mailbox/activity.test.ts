import { describe, expect, test } from "vitest";
import {
	ACTIVITY_LIMIT,
	handle,
	memoryStore,
	type ActivityEntry,
	type PendingRequest,
} from "../../mailbox/api/_mailbox.js";
import { redisStore } from "../../mailbox/api/_redis.js";
import {
	describeEntry,
	describeSummary,
	summarizeActivity,
} from "../../src/mailbox-activity.js";

const ENGINE = "engine-key-for-tests";
const NOW = new Date("2026-11-01T12:00:00Z");

function req(id: string, agent: string, kind = "decision"): PendingRequest {
	return {
		id,
		agent,
		kind,
		prompt: "SECRET PROMPT TEXT",
		replySchema: { type: "object" },
		deadline: new Date(NOW.getTime() + 3_600_000).toISOString(),
		level: 0,
	};
}

function mailbox() {
	const store = memoryStore();
	let now = NOW;
	const send = async (
		method: string,
		path: string,
		key: string | undefined,
		body?: unknown,
	) => {
		const response = await handle(
			new Request(`https://mailbox.test${path}`, {
				method,
				headers: {
					"content-type": "application/json",
					...(key && { authorization: `Bearer ${key}` }),
				},
				...(body !== undefined && { body: JSON.stringify(body) }),
			}),
			store,
			{
				engineKey: ENGINE,
				now: () => now,
				sleep: async (ms) => {
					now = new Date(now.getTime() + ms);
				},
			},
		);
		const text = await response.text();
		return {
			status: response.status,
			body: text ? JSON.parse(text) : undefined,
		};
	};
	const register = async (agent: string) =>
		(await send("POST", "/engine/agents", ENGINE, { agent })).body
			.key as string;
	const tool = (key: string, name: string, args: unknown) =>
		send("POST", "/mcp", key, {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name, arguments: args },
		});
	const trail = async (agent: string, limit?: number) =>
		(
			await send("POST", "/engine/activity", ENGINE, {
				agent,
				...(limit && { limit }),
			})
		).body.activity as ActivityEntry[];
	return { store, send, register, tool, trail };
}

describe("an agent's trail at the mailbox", () => {
	test("records MCP reads and answers, newest first, with no prompt or reply text", async () => {
		const { store, register, tool, trail } = mailbox();
		const key = await register("muse");
		await store.putRequests([req("r1", "muse", "commit")]);
		await tool(key, "get_pending", { wait_seconds: 0 });
		await tool(key, "submit_answer", {
			id: "r1",
			reply: { secret: "REPLY TEXT" },
		});
		await tool(key, "get_pending", { wait_seconds: 4 });
		const t = await trail("muse");
		expect(t.map((e) => [e.tool, e.result])).toEqual([
			["get_pending", "none"],
			["submit_answer", "accepted"],
			["get_pending", "request"],
		]);
		expect(t[2]).toMatchObject({
			via: "mcp",
			request: "r1",
			kind: "commit",
		});
		expect(t[0]).toMatchObject({ waited: 4 });
		expect(JSON.stringify(t)).not.toContain("SECRET PROMPT TEXT");
		expect(JSON.stringify(t)).not.toContain("REPLY TEXT");
	});

	test("records bad answer arguments, and answers for requests that are not the agent's", async () => {
		const { store, register, tool, trail } = mailbox();
		const key = await register("muse");
		await register("grokbot");
		await store.putRequests([req("theirs", "grokbot")]);
		await tool(key, "submit_answer", { id: "x" });
		await tool(key, "submit_answer", { id: "theirs", reply: {} });
		const t = await trail("muse");
		expect(t.map((e) => e.result)).toEqual([
			"unknown",
			"invalid_arguments",
		]);
	});

	test("records the REST endpoints too, marked as rest", async () => {
		const { store, register, send, trail } = mailbox();
		const key = await register("grokbot");
		await store.putRequests([req("r1", "grokbot")]);
		await send("GET", "/pending", key);
		await send("POST", "/answers", key, {
			answers: [{ id: "r1", reply: {} }],
		});
		const t = await trail("grokbot");
		expect(t.map((e) => [e.via, e.tool, e.result])).toEqual([
			["rest", "answers", "accepted"],
			["rest", "pending", "request"],
		]);
	});

	test("each agent has its own trail, and only the engine can read it", async () => {
		const { register, tool, send, trail } = mailbox();
		const a = await register("muse");
		await register("grokbot");
		await tool(a, "get_pending", { wait_seconds: 0 });
		expect(await trail("muse")).toHaveLength(1);
		expect(await trail("grokbot")).toHaveLength(0);
		expect(
			(await send("POST", "/engine/activity", a, { agent: "muse" }))
				.status,
		).toBe(401);
		expect(
			(
				await send("POST", "/engine/activity", undefined, {
					agent: "muse",
				})
			).status,
		).toBe(401);
	});

	test("keeps only the newest entries, and honors a smaller limit", async () => {
		const store = memoryStore();
		for (let i = 0; i < ACTIVITY_LIMIT + 5; i++) {
			await store.note("muse", {
				at: new Date(NOW.getTime() + i * 1000).toISOString(),
				via: "mcp",
				tool: "get_pending",
				result: "none",
			});
		}
		const all = await store.activity("muse", ACTIVITY_LIMIT + 50);
		expect(all).toHaveLength(ACTIVITY_LIMIT);
		expect(all[0]!.at).toBe(
			new Date(NOW.getTime() + (ACTIVITY_LIMIT + 4) * 1000).toISOString(),
		);
		expect(await store.activity("muse", 3)).toHaveLength(3);
	});

	test("a failing trail never fails the agent's call", async () => {
		const { store, register, tool } = mailbox();
		const key = await register("muse");
		store.note = async () => {
			throw new Error("redis is down");
		};
		const r = await tool(key, "get_pending", { wait_seconds: 0 });
		expect(r.status).toBe(200);
		expect(r.body.result.isError).toBeUndefined();
	});
});

describe("the trail in Redis", () => {
	test("writes newest-first, capped and expiring, in one pipeline", async () => {
		const calls: unknown[][] = [];
		const pipe = {
			lpush: (...a: unknown[]) => (calls.push(["lpush", ...a]), pipe),
			ltrim: (...a: unknown[]) => (calls.push(["ltrim", ...a]), pipe),
			expire: (...a: unknown[]) => (calls.push(["expire", ...a]), pipe),
			exec: async () => (calls.push(["exec"]), []),
		};
		const redis = {
			pipeline: () => pipe,
			lrange: async (...a: unknown[]) => (
				calls.push(["lrange", ...a]),
				[]
			),
		};
		const store = redisStore(
			redis as unknown as Parameters<typeof redisStore>[0],
		);
		const entry: ActivityEntry = {
			at: "2026-11-01T12:00:00.000Z",
			via: "mcp",
			tool: "get_pending",
			result: "none",
		};
		await store.note("muse", entry);
		await store.activity("muse", 10);
		expect(calls).toEqual([
			["lpush", "activity:muse", entry],
			["ltrim", "activity:muse", 0, ACTIVITY_LIMIT - 1],
			["expire", "activity:muse", 7 * 24 * 60 * 60],
			["exec"],
			["lrange", "activity:muse", 0, 9],
		]);
	});
});

const at = (s: number) => new Date(NOW.getTime() + s * 1000).toISOString();
const read = (s: number, request?: string, kind?: string): ActivityEntry => ({
	at: at(s),
	via: "mcp",
	tool: "get_pending",
	result: request ? "request" : "none",
	...(request && { request, kind: kind ?? "decision" }),
	waited: 20,
});
const answer = (
	s: number,
	request: string,
	result = "accepted",
): ActivityEntry => ({
	at: at(s),
	via: "mcp",
	tool: "submit_answer",
	request,
	result,
});

describe("summarizeActivity", () => {
	test("finds requests the agent saw but never got an accepted answer in, and the longest gap", () => {
		const s = summarizeActivity([
			read(0),
			read(20, "a", "offers"),
			answer(40, "a"),
			read(45, "b", "commit"),
			answer(60, "b", "expired"),
			read(1500),
			read(1520, "c", "discovery"),
			answer(1540, "c"),
		]);
		expect(s.reads).toBe(5);
		expect(s.answers).toBe(3);
		expect(s.seenNeverAnswered.map((r) => [r.request, r.kind])).toEqual([
			["b", "commit"],
		]);
		expect(s.longestGap).toEqual({ seconds: 1440, from: at(60) });
	});

	test("a request seen only once but answered, or answered twice, counts as answered", () => {
		const s = summarizeActivity([
			read(0, "a"),
			answer(5, "a", "duplicate"),
			read(10, "a"),
		]);
		expect(s.seenNeverAnswered).toEqual([]);
		expect(s.seen).toEqual(["a"]);
	});

	test("an agent that never called has an empty summary", () => {
		const s = summarizeActivity([]);
		expect(s).toMatchObject({
			reads: 0,
			answers: 0,
			longestGap: undefined,
			firstCall: undefined,
		});
		expect(describeSummary(s)[0]).toContain("0 reads");
	});

	test("reads as plain lines", () => {
		expect(describeEntry(read(0))).toContain(
			"nothing waiting (waited 20s)",
		);
		expect(describeEntry(read(0, "r1", "commit"))).toContain(
			"returned commit r1",
		);
		expect(describeEntry(answer(0, "r1"))).toContain("accepted r1");
		const lines = describeSummary(
			summarizeActivity([read(0, "r1", "commit")]),
		);
		expect(lines.join("\n")).toContain("never answered in time: commit r1");
	});
});
