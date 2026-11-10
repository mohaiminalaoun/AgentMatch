import { describe, expect, test } from "vitest";
import {
	handle,
	memoryStore,
	type PendingRequest,
} from "../../mailbox/api/_mailbox.js";

const ENGINE = "engine-key-for-tests";
const NOW = new Date("2026-11-01T12:00:00Z");

function request(id: string, agent: string, minutes = 60): PendingRequest {
	return {
		id,
		agent,
		kind: "decision",
		prompt: `Decide on proposal ${id}.`,
		replySchema: { type: "object" },
		deadline: new Date(NOW.getTime() + minutes * 60_000).toISOString(),
		level: 0,
	};
}

// A mailbox in memory with a fake clock that only moves when something sleeps, so waits cost no real time.
function mailbox(maxWaitSeconds?: number) {
	const store = memoryStore();
	let now = NOW;
	const sleeps: number[] = [];
	const send = async (
		path: string,
		key: string | undefined,
		body: unknown,
	) => {
		const response = await handle(
			new Request(`https://mailbox.test${path}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(key && { authorization: `Bearer ${key}` }),
				},
				body: JSON.stringify(body),
			}),
			store,
			{
				engineKey: ENGINE,
				now: () => now,
				sleep: async (ms) => {
					sleeps.push(ms);
					now = new Date(now.getTime() + ms);
				},
				...(maxWaitSeconds && { maxWaitSeconds }),
			},
		);
		const text = await response.text();
		return {
			status: response.status,
			body: text ? JSON.parse(text) : undefined,
		};
	};
	const register = async (agent: string) =>
		(await send("/engine/agents", ENGINE, { agent })).body.key as string;
	const mcp = (
		key: string | undefined,
		method: string,
		params?: unknown,
		id = 1,
	) =>
		send("/mcp", key, {
			jsonrpc: "2.0",
			id,
			method,
			...(params !== undefined && { params }),
		});
	const tool = async (key: string, name: string, args?: unknown) => {
		const r = await mcp(key, "tools/call", { name, arguments: args });
		const result = r.body.result;
		return {
			isError: result.isError === true,
			value: JSON.parse(result.content[0].text),
		};
	};
	return { store, send, register, mcp, tool, sleeps };
}

describe("mailbox MCP", () => {
	test("needs the same agent key as the REST endpoints", async () => {
		const { mcp } = mailbox();
		expect((await mcp(undefined, "ping")).status).toBe(401);
		expect((await mcp("not-a-key", "ping")).status).toBe(401);
	});

	test("initialize echoes a supported version and carries the listening instructions", async () => {
		const { register, mcp } = mailbox();
		const key = await register("muse");
		const r = await mcp(key, "initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		});
		expect(r.status).toBe(200);
		expect(r.body.result.protocolVersion).toBe("2025-06-18");
		expect(r.body.result.instructions).toContain("get_pending");
		const other = await mcp(key, "initialize", {
			protocolVersion: "1999-01-01",
		});
		expect(other.body.result.protocolVersion).toBe("2025-11-25");
	});

	test("a notification gets 202 and no body", async () => {
		const { register, send } = mailbox();
		const key = await register("muse");
		const r = await send("/mcp", key, {
			jsonrpc: "2.0",
			method: "notifications/initialized",
		});
		expect(r).toEqual({ status: 202, body: undefined });
	});

	test("lists the two tools, with the wait cap in the schema", async () => {
		const { register, mcp } = mailbox(30);
		const key = await register("muse");
		const { tools } = (await mcp(key, "tools/list")).body.result;
		expect(tools.map((t: { name: string }) => t.name)).toEqual([
			"get_pending",
			"submit_answer",
		]);
		expect(tools[0].inputSchema.properties.wait_seconds.maximum).toBe(30);
	});

	test("modern clients get resultType and serverInfo on a valid key", async () => {
		const store = memoryStore();
		const registered = await handle(
			new Request("https://mailbox.test/engine/agents", {
				method: "POST",
				headers: { authorization: `Bearer ${ENGINE}` },
				body: JSON.stringify({ agent: "muse" }),
			}),
			store,
			{ engineKey: ENGINE },
		);
		const { key } = await registered.json();
		const response = await handle(
			new Request("https://mailbox.test/mcp", {
				method: "POST",
				headers: {
					authorization: `Bearer ${key}`,
					"mcp-protocol-version": "2026-07-28",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "tools/list",
				}),
			}),
			store,
			{ engineKey: ENGINE },
		);
		const body = await response.json();
		expect(body.result.resultType).toBe("complete");
		expect(
			body.result._meta["io.modelcontextprotocol/serverInfo"].name,
		).toBe("agent-match-mailbox");
	});

	test("get_pending returns the oldest open request, without the agent id, and reading changes nothing", async () => {
		const { store, register, tool } = mailbox();
		const key = await register("muse");
		await store.putRequests([request("r1", "muse"), request("r2", "muse")]);
		const first = await tool(key, "get_pending", { wait_seconds: 0 });
		expect(first.value.request.id).toBe("r1");
		expect(first.value.request).not.toHaveProperty("agent");
		expect(first.value.waiting).toBe(2);
		expect(first.value.seconds_left).toBe(3600);
		expect(
			(await tool(key, "get_pending", { wait_seconds: 0 })).value.request
				.id,
		).toBe("r1");
	});

	test("get_pending says which agent the key belongs to, with or without a request", async () => {
		const { store, register, tool } = mailbox();
		const key = await register("muse");
		expect(
			(await tool(key, "get_pending", { wait_seconds: 0 })).value.agent,
		).toBe("muse");
		await store.putRequests([request("r1", "muse")]);
		expect(
			(await tool(key, "get_pending", { wait_seconds: 0 })).value.agent,
		).toBe("muse");
	});

	test("get_pending never shows another agent's request or one past its deadline", async () => {
		const { store, register, tool } = mailbox();
		const key = await register("muse");
		await register("grokbot");
		await store.putRequests([
			request("theirs", "grokbot"),
			request("late", "muse", -1),
		]);
		expect(
			(await tool(key, "get_pending", { wait_seconds: 0 })).value.request,
		).toBeNull();
	});

	test("with nothing waiting it waits in steps, up to the time asked, then says so", async () => {
		const { register, tool, sleeps } = mailbox();
		const key = await register("muse");
		const r = await tool(key, "get_pending", { wait_seconds: 5 });
		expect(r.value.request).toBeNull();
		expect(sleeps).toEqual([2000, 2000, 1000]);
	});

	test("a request that arrives while it waits is returned without waiting out the time", async () => {
		const { store, register, tool, sleeps } = mailbox();
		const key = await register("muse");
		const original = store.pending;
		let looks = 0;
		store.pending = async (agent) => {
			looks++;
			if (looks === 3)
				await store.putRequests([request("late-arrival", "muse")]);
			return original(agent);
		};
		const r = await tool(key, "get_pending", { wait_seconds: 20 });
		expect(r.value.request.id).toBe("late-arrival");
		expect(sleeps.length).toBe(2);
	});

	test("the wait is capped, and defaults to a short one", async () => {
		const capped = mailbox(6);
		const key = await capped.register("muse");
		await capped.tool(key, "get_pending", { wait_seconds: 600 });
		expect(capped.sleeps.reduce((a, b) => a + b, 0)).toBe(6000);
		const dflt = mailbox();
		const key2 = await dflt.register("muse");
		await dflt.tool(key2, "get_pending");
		expect(dflt.sleeps.reduce((a, b) => a + b, 0)).toBe(10_000);
	});

	test("submit_answer stores once, and the engine can read it back", async () => {
		const { store, register, tool, send } = mailbox();
		const key = await register("muse");
		await store.putRequests([request("r1", "muse")]);
		const first = await tool(key, "submit_answer", {
			id: "r1",
			reply: { decision: "accept" },
		});
		expect(first.value.status).toBe("accepted");
		const again = await tool(key, "submit_answer", {
			id: "r1",
			reply: { decision: "decline" },
		});
		expect(again.value.status).toBe("duplicate");
		const stored = await send("/engine/answers", ENGINE, { ids: ["r1"] });
		expect(stored.body.answers.r1.reply).toEqual({ decision: "accept" });
		// Answered requests stop showing as waiting.
		expect(
			(await tool(key, "get_pending", { wait_seconds: 0 })).value.request,
		).toBeNull();
	});

	test("submit_answer reads a reply sent as a JSON string", async () => {
		const { store, register, tool, send } = mailbox();
		const key = await register("muse");
		await store.putRequests([request("r1", "muse")]);
		const r = await tool(key, "submit_answer", {
			id: "r1",
			reply: '{"decision":"accept"}',
		});
		expect(r.value.status).toBe("accepted");
		expect(
			(await send("/engine/answers", ENGINE, { ids: ["r1"] })).body
				.answers.r1.reply,
		).toEqual({
			decision: "accept",
		});
	});

	test("submit_answer says unknown for another agent's request and expired past the deadline", async () => {
		const { store, register, tool } = mailbox();
		const key = await register("muse");
		await register("grokbot");
		await store.putRequests([
			request("theirs", "grokbot"),
			request("late", "muse", -1),
		]);
		expect(
			(await tool(key, "submit_answer", { id: "theirs", reply: {} }))
				.value.status,
		).toBe("unknown");
		expect(
			(await tool(key, "submit_answer", { id: "late", reply: {} })).value
				.status,
		).toBe("expired");
	});

	test("bad tool arguments come back as a tool error the model can read, not a protocol error", async () => {
		const { register, tool } = mailbox();
		const key = await register("muse");
		const r = await tool(key, "submit_answer", {
			id: "r1",
			reply: "just some words",
		});
		expect(r.isError).toBe(true);
		expect(r.value.error).toContain("reply");
		expect(
			(await tool(key, "get_pending", { wait_seconds: "soon" })).isError,
		).toBe(true);
	});

	test("unknown tools and methods are protocol errors", async () => {
		const { register, mcp } = mailbox();
		const key = await register("muse");
		expect(
			(await mcp(key, "tools/call", { name: "delete_everything" })).body
				.error.code,
		).toBe(-32602);
		expect((await mcp(key, "resources/list")).body.error.code).toBe(-32601);
	});

	test("GET and batches are refused", async () => {
		const { store, register, send } = mailbox();
		const key = await register("muse");
		expect(
			(
				await send("/mcp", key, [
					{ jsonrpc: "2.0", id: 1, method: "ping" },
				])
			).status,
		).toBe(400);
		const get = await handle(
			new Request("https://mailbox.test/mcp", {
				headers: { authorization: `Bearer ${key}` },
			}),
			store,
			{ engineKey: ENGINE },
		);
		expect(get.status).toBe(405);
	});
});
