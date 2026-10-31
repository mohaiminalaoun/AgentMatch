// The mailbox's store on Upstash Redis, which survives between serverless calls.
// Everything expires a week after it was last written, so old runs clean themselves up.
import { Redis } from "@upstash/redis";
import type { PendingRequest, Store, StoredAnswer } from "./_mailbox.js";

const WEEK = 7 * 24 * 60 * 60;

// Vercel's Upstash integration names the settings either way, depending on how it was added.
export function redisFromEnv(env: Record<string, string | undefined>): Redis {
	const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
	const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
	if (!url || !token) {
		throw new Error("the Upstash Redis URL and token are not set");
	}
	return new Redis({ url, token });
}

export function redisStore(redis: Redis): Store {
	return {
		agentForKey: async (hash) =>
			(await redis.get<string>(`agentkey:${hash}`)) ?? undefined,
		setAgentKey: async (agent, hash) => {
			const old = await redis.get<string>(`keyof:${agent}`);
			if (old) await redis.del(`agentkey:${old}`);
			await redis.set(`agentkey:${hash}`, agent, { ex: WEEK });
			await redis.set(`keyof:${agent}`, hash, { ex: WEEK });
		},
		putRequests: async (requests) => {
			for (const r of requests) {
				await redis.set(`req:${r.id}`, r, { ex: WEEK });
				await redis.rpush(`pending:${r.agent}`, r.id);
				await redis.expire(`pending:${r.agent}`, WEEK);
			}
		},
		request: async (id) =>
			(await redis.get<PendingRequest>(`req:${id}`)) ?? undefined,
		pending: async (agent) => {
			const ids = await redis.lrange<string>(`pending:${agent}`, 0, -1);
			if (ids.length === 0) return [];
			const [requests, answered] = await Promise.all([
				redis.mget<(PendingRequest | null)[]>(
					...ids.map((id) => `req:${id}`),
				),
				redis.mget<(StoredAnswer | null)[]>(
					...ids.map((id) => `answer:${id}`),
				),
			]);
			return requests.filter(
				(r, i): r is PendingRequest =>
					r !== null && answered[i] === null,
			);
		},
		// SET NX: only the first answer is stored, however many times it's posted.
		answerOnce: async (request, answer) =>
			(await redis.set(`answer:${request.id}`, answer, {
				nx: true,
				ex: WEEK,
			})) === "OK",
		answers: async (ids) => {
			const found = await redis.mget<(StoredAnswer | null)[]>(
				...ids.map((id) => `answer:${id}`),
			);
			return Object.fromEntries(
				ids.flatMap((id, i) => (found[i] ? [[id, found[i]]] : [])),
			);
		},
	};
}
