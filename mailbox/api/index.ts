// The Vercel function: every path is rewritten here (vercel.json), and `handle` routes it.
import { handle } from "./_mailbox.js";
import { redisFromEnv, redisStore } from "./_redis.js";

const store = redisStore(redisFromEnv(process.env));
const engineKey = process.env.MAILBOX_ENGINE_KEY ?? "";
// How long the MCP get_pending tool may wait; keep it under the function's maxDuration (vercel.json).
const maxWaitSeconds =
	Number(process.env.MAILBOX_MAX_WAIT_SECONDS) || undefined;

export function GET(request: Request): Promise<Response> {
	return handle(request, store, {
		engineKey,
		...(maxWaitSeconds && { maxWaitSeconds }),
	});
}

export function POST(request: Request): Promise<Response> {
	return handle(request, store, {
		engineKey,
		...(maxWaitSeconds && { maxWaitSeconds }),
	});
}
