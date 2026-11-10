import { describe, expect, test } from "vitest";
import type { ActivityEntry } from "../../mailbox/api/_mailbox.js";
import {
	checkListening,
	describeListenCheck,
	judgeListening,
	LISTEN_MAX_AGE_SECONDS,
} from "../../src/pilot/listening.js";

const NOW = Date.parse("2026-11-10T18:00:00Z");
const entry = (secondsAgo: number): ActivityEntry => ({
	at: new Date(NOW - secondsAgo * 1000).toISOString(),
	via: "mcp",
	tool: "get_pending",
	result: "none",
});

describe("judgeListening", () => {
	test("an agent whose newest call is recent is listening", () => {
		expect(judgeListening([entry(12), entry(40)], NOW)).toEqual({
			state: "listening",
			ageSeconds: 12,
		});
	});

	test("the limit itself still counts as listening; a second past it does not", () => {
		expect(judgeListening([entry(LISTEN_MAX_AGE_SECONDS)], NOW).state).toBe(
			"listening",
		);
		expect(
			judgeListening([entry(LISTEN_MAX_AGE_SECONDS + 1)], NOW),
		).toMatchObject({
			state: "stale",
			ageSeconds: LISTEN_MAX_AGE_SECONDS + 1,
		});
	});

	test("an agent with no calls on record is stale, with nothing to say about when", () => {
		expect(judgeListening([], NOW)).toEqual({
			state: "stale",
			lastAt: undefined,
			ageSeconds: undefined,
		});
	});

	test("judges by the newest entry, and a clock a little behind counts as just now", () => {
		expect(judgeListening([entry(5), entry(9999)], NOW).state).toBe(
			"listening",
		);
		expect(judgeListening([entry(-3)], NOW)).toEqual({
			state: "listening",
			ageSeconds: 0,
		});
	});

	test("takes a different limit", () => {
		expect(judgeListening([entry(100)], NOW, 120).state).toBe("listening");
		expect(judgeListening([entry(100)], NOW, 30).state).toBe("stale");
	});
});

const settings = {
	url: "https://mailbox.test/base",
	engineKey: "engine-key-for-tests",
};
const reply = (status: number, body: unknown) =>
	(async () =>
		new Response(typeof body === "string" ? body : JSON.stringify(body), {
			status,
		})) as typeof fetch;

describe("checkListening", () => {
	test("asks the mailbox for the agent's newest call, with the engine key", async () => {
		let seen: { url: string; init: RequestInit } | undefined;
		const fetchFn = (async (url: URL, init?: RequestInit) => {
			seen = { url: url.href, init: init! };
			return new Response(JSON.stringify({ activity: [entry(8)] }));
		}) as typeof fetch;
		const r = await checkListening(settings, "muse", {
			fetch: fetchFn,
			now: () => NOW,
		});
		expect(r).toEqual({ state: "listening", ageSeconds: 8 });
		expect(seen!.url).toBe("https://mailbox.test/engine/activity");
		expect(seen!.init.method).toBe("POST");
		expect(
			(seen!.init.headers as Record<string, string>).authorization,
		).toBe("Bearer engine-key-for-tests");
		expect(JSON.parse(seen!.init.body as string)).toEqual({
			agent: "muse",
			limit: 1,
		});
		expect(seen!.init.redirect).toBe("error");
	});

	test("a stale or empty trail is stale", async () => {
		expect(
			(
				await checkListening(settings, "muse", {
					fetch: reply(200, { activity: [entry(500)] }),
					now: () => NOW,
				})
			).state,
		).toBe("stale");
		expect(
			(
				await checkListening(settings, "muse", {
					fetch: reply(200, { activity: [] }),
					now: () => NOW,
				})
			).state,
		).toBe("stale");
	});

	test.each([
		[
			"an older mailbox with no trail",
			reply(404, { error: "no such endpoint" }),
			/no call trail/,
		],
		[
			"a wrong engine key",
			reply(401, { error: "not the engine key" }),
			/answered 401/,
		],
		["a server error", reply(500, "oops"), /answered 500/],
		["an answer that is not JSON", reply(200, "<html>"), /not JSON/],
		[
			"an answer without a list",
			reply(200, { nothing: true }),
			/no activity list/,
		],
		[
			"a network failure",
			(async () => {
				throw new Error("getaddrinfo ENOTFOUND");
			}) as typeof fetch,
			/could not reach the mailbox.*ENOTFOUND/,
		],
	])(
		"%s is unknown, never a reason to block the run",
		async (_name, fetchFn, reason) => {
			const r = await checkListening(settings, "muse", {
				fetch: fetchFn,
				now: () => NOW,
			});
			expect(r.state).toBe("unknown");
			expect((r as { reason: string }).reason).toMatch(reason);
		},
	);
});

describe("describeListenCheck", () => {
	test("says how long ago when listening", () => {
		expect(
			describeListenCheck("muse", { state: "listening", ageSeconds: 12 }),
		).toBe("muse is listening (its last call at the mailbox was 12s ago)");
	});

	test("a stale agent gets the way out, with the time of its last call when there was one", () => {
		const never = describeListenCheck("muse", {
			state: "stale",
			lastAt: undefined,
			ageSeconds: undefined,
		});
		expect(never).toContain("muse has made no calls at the mailbox");
		expect(never).toContain("docs/muse.md");
		expect(never).toContain("--skip-listen-check");
		const old = describeListenCheck("muse", {
			state: "stale",
			lastAt: "2026-11-10T17:34:21.000Z",
			ageSeconds: 1600,
		});
		expect(old).toContain("1600s ago (17:34:21 UTC)");
	});

	test("an unknown result says the run continues", () => {
		const text = describeListenCheck("muse", {
			state: "unknown",
			reason: "the mailbox answered 500",
		});
		expect(text).toContain("could not check whether muse is listening");
		expect(text).toContain("Continuing");
	});
});
