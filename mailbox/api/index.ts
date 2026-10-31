// The Vercel function: every path is rewritten here (vercel.json), and `handle` routes it.
import { handle } from "./_mailbox.js";
import { redisFromEnv, redisStore } from "./_redis.js";

const store = redisStore(redisFromEnv(process.env));
const engineKey = process.env.MAILBOX_ENGINE_KEY ?? "";

export function GET(request: Request): Promise<Response> {
	return handle(request, store, { engineKey });
}

export function POST(request: Request): Promise<Response> {
	return handle(request, store, { engineKey });
}
