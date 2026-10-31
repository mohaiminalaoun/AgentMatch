import { describe, expect, test } from "vitest";
import {
	handle,
	memoryStore,
	type PendingRequest,
} from "../../mailbox/api/_mailbox.js";

const ENGINE = "engine-key-for-tests";
const NOW = new Date("2026-11-01T12:00:00Z");

// A mailbox in memory, plus a helper that calls it like an HTTP client would.
function mailbox() {
	const store = memoryStore();
	let now = NOW;
	const call = async (
		method: string,
		path: string,
		key?: string,
		body?: unknown,
	) => {
		const response = await handle(
			new Request(`https://mailbox.test${path}`, {
				method,
				headers: {
					...(key && { authorization: `Bearer ${key}` }),
					...(body !== undefined && {
						"content-type": "application/json",
					}),
				},
				...(body !== undefined && { body: JSON.stringify(body) }),
			}),
			store,
			{ engineKey: ENGINE, now: () => now },
		);
		return { status: response.status, body: await response.json() };
	};
	const register = async (agent: string): Promise<string> =>
		(await call("POST", "/engine/agents", ENGINE, { agent })).body.key;
	const setNow = (date: Date) => {
		now = date;
	};
	return { call, register, setNow };
}

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

describe("mailbox", () => {
	test("an agent sees only its own waiting requests, without its id, and reading changes nothing", async () => {
		const { call, register } = mailbox();
		const muse = await register("muse");
		await register("other");
		await call("POST", "/engine/requests", ENGINE, {
			requests: [request("r1", "muse"), request("r2", "other")],
		});
		const first = await call("GET", "/pending", muse);
		expect(first.status).toBe(200);
		expect(first.body.requests).toEqual([
			{
				id: "r1",
				kind: "decision",
				prompt: "Decide on proposal r1.",
				replySchema: { type: "object" },
				deadline: request("r1", "muse").deadline,
				level: 0,
			},
		]);
		expect((await call("GET", "/pending", muse)).body).toEqual(first.body);
	});

	test("the first answer stands: a repeat is a no-op, and the request leaves the pending list", async () => {
		const { call, register } = mailbox();
		const muse = await register("muse");
		await call("POST", "/engine/requests", ENGINE, {
			requests: [request("r1", "muse")],
		});
		const post = (reply: object) =>
			call("POST", "/answers", muse, { answers: [{ id: "r1", reply }] });
		expect((await post({ decision: "accept" })).body.results).toEqual([
			{ id: "r1", status: "accepted" },
		]);
		expect((await post({ decision: "decline" })).body.results).toEqual([
			{ id: "r1", status: "duplicate" },
		]);
		expect((await call("GET", "/pending", muse)).body.requests).toEqual([]);
		const answers = await call("POST", "/engine/answers", ENGINE, {
			ids: ["r1", "r9"],
		});
		expect(answers.body.answers).toEqual({
			r1: { reply: { decision: "accept" }, at: NOW.toISOString() },
		});
	});

	test("answering another agent's request looks the same as answering none, and changes nothing", async () => {
		const { call, register } = mailbox();
		const muse = await register("muse");
		await register("other");
		await call("POST", "/engine/requests", ENGINE, {
			requests: [request("r2", "other")],
		});
		const result = await call("POST", "/answers", muse, {
			answers: [
				{ id: "r2", reply: {} },
				{ id: "nope", reply: {} },
			],
		});
		expect(result.body.results).toEqual([
			{ id: "r2", status: "unknown" },
			{ id: "nope", status: "unknown" },
		]);
		expect(
			(await call("POST", "/engine/answers", ENGINE, { ids: ["r2"] }))
				.body.answers,
		).toEqual({});
	});

	test("past its deadline, a request disappears and its answer is refused", async () => {
		const { call, register, setNow } = mailbox();
		const muse = await register("muse");
		await call("POST", "/engine/requests", ENGINE, {
			requests: [request("r1", "muse", 30)],
		});
		setNow(new Date(NOW.getTime() + 31 * 60_000));
		expect((await call("GET", "/pending", muse)).body.requests).toEqual([]);
		expect(
			(
				await call("POST", "/answers", muse, {
					answers: [{ id: "r1", reply: {} }],
				})
			).body.results,
		).toEqual([{ id: "r1", status: "expired" }]);
	});

	test("keys: none, a wrong one, an agent key on engine endpoints, and a replaced key are all refused", async () => {
		const { call, register } = mailbox();
		const first = await register("muse");
		expect((await call("GET", "/pending")).status).toBe(401);
		expect((await call("GET", "/pending", "am_wrong")).status).toBe(401);
		expect(
			(await call("POST", "/engine/agents", first, { agent: "x" }))
				.status,
		).toBe(401);
		const second = await register("muse");
		expect((await call("GET", "/pending", first)).status).toBe(401);
		expect((await call("GET", "/pending", second)).status).toBe(200);
	});

	test("bad bodies get a 400 naming the problem, and GET / describes the API without a key", async () => {
		const { call, register } = mailbox();
		const muse = await register("muse");
		const bad = await call("POST", "/answers", muse, { answers: [] });
		expect(bad.status).toBe(400);
		expect(bad.body.problems[0]).toMatch(/^answers:/);
		const about = await call("GET", "/");
		expect(about.status).toBe(200);
		expect(Object.keys(about.body.endpoints)).toEqual([
			"GET /pending",
			"POST /answers",
		]);
	});
});
