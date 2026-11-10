import { describe, expect, test } from "vitest";
import { handle, memoryStore } from "../../mailbox/api/_mailbox.js";
import { redisStore } from "../../mailbox/api/_redis.js";

const ENGINE = "engine-key-for-tests";
const WEEK = 7 * 24 * 60 * 60;
// The Redis client type, taken from the store so the tests need no import from the mailbox project's packages.
type Redis = Parameters<typeof redisStore>[0];

async function register(agent: string) {
	const response = await handle(
		new Request("https://mailbox.test/engine/agents", {
			method: "POST",
			headers: {
				authorization: `Bearer ${ENGINE}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ agent }),
		}),
		memoryStore(),
		{ engineKey: ENGINE },
	);
	return { status: response.status, body: await response.json() };
}

describe("registering an agent", () => {
	test.each(["muse", "grokbot", "Muse_2", "p-4k2m", "a-b_c"])(
		"accepts %s",
		async (name) => {
			const r = await register(name);
			expect(r.status).toBe(200);
			expect(r.body.agent).toBe(name);
		},
	);

	test.each(["muse.", "mu se", "muse!", "muse/x", "", "café"])(
		"refuses %j with a message that names the rule",
		async (name) => {
			const r = await register(name);
			expect(r.status).toBe(400);
			expect(JSON.stringify(r.body.problems)).toMatch(
				name === "" ? /agent/ : /letters, digits/,
			);
		},
	);
});

// A Redis with just the commands the key lookup uses, remembering each key's remaining lifetime.
function fakeRedis(values: Record<string, string>) {
	const ttl = new Map<string, number>();
	const redis = {
		getex: async (key: string, opts: { ex: number }) => {
			if (!(key in values)) return null;
			ttl.set(key, opts.ex);
			return values[key];
		},
		expire: async (key: string, seconds: number) => {
			ttl.set(key, seconds);
			return 1;
		},
	};
	return { redis: redis as unknown as Redis, ttl };
}

describe("an agent's key in Redis", () => {
	test("using it renews the key and its reverse link for a full week", async () => {
		const { redis, ttl } = fakeRedis({ "agentkey:abc": "muse" });
		expect(await redisStore(redis).agentForKey("abc")).toBe("muse");
		expect(ttl.get("agentkey:abc")).toBe(WEEK);
		expect(ttl.get("keyof:muse")).toBe(WEEK);
	});

	test("an unknown or expired key is refused and renews nothing", async () => {
		const { redis, ttl } = fakeRedis({});
		expect(await redisStore(redis).agentForKey("nope")).toBeUndefined();
		expect(ttl.size).toBe(0);
	});
});
