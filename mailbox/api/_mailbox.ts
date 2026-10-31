// The mailbox between the engine and outside agents (step 11.13). Outside agents can't be called, only call
// out, so the engine leaves each decision it needs from one here, and the agent picks it up on its own schedule
// and answers. The mailbox only stores and hands over: the engine still validates every answer and runs the
// gate, so a bad or hostile answer is caught there, never trusted here.
//
// Two kinds of caller, each with a bearer key:
// - an outside agent (one key per agent, made by the engine): GET /pending, POST /answers
// - the engine (one key, MAILBOX_ENGINE_KEY): POST /engine/agents, /engine/requests, /engine/answers
//
// The file name starts with "_" so Vercel doesn't serve it as a function of its own.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// A decision the engine needs from one outside agent.
export const PendingRequest = z.object({
	// Unique across the run; answers name it.
	id: z.string().min(1).max(200),
	// The agent that must answer; never shown to anyone else.
	agent: z.string().min(1).max(100),
	// What is being decided, e.g. "decision", "interest", "commit".
	kind: z.string().min(1).max(50),
	// The situation and the question, as text.
	prompt: z.string().min(1).max(100_000),
	// The reply must be a JSON object matching this JSON Schema.
	replySchema: z.record(z.string(), z.unknown()),
	// After this (ISO 8601), answers are refused and the engine uses its safe default.
	deadline: z.iso.datetime(),
	// The disclosure level of the conversation this belongs to, 0 to 3.
	level: z.int().min(0).max(3),
});
export type PendingRequest = z.infer<typeof PendingRequest>;

export const MAX_ANSWERS_PER_POST = 50;

const Answers = z.object({
	answers: z
		.array(
			z.object({
				id: z.string().min(1).max(200),
				reply: z.record(z.string(), z.unknown()),
			}),
		)
		.min(1)
		.max(MAX_ANSWERS_PER_POST),
});

const AgentRegistration = z.object({ agent: z.string().min(1).max(100) });
const RequestBatch = z.object({
	requests: z.array(PendingRequest).min(1).max(200),
});
const AnswerQuery = z.object({
	ids: z.array(z.string().min(1).max(200)).min(1).max(500),
});

export type StoredAnswer = { reply: Record<string, unknown>; at: string };

// What happened to one posted answer.
export type AnswerStatus =
	// Stored; the engine will validate it.
	| "accepted"
	// This request was already answered; the first answer stands and this one changed nothing.
	| "duplicate"
	// No such request for this agent.
	| "unknown"
	// Past its deadline; the engine has used its safe default.
	| "expired";

// Where the mailbox keeps things: Redis in production, memory in tests.
export type Store = {
	agentForKey(keyHash: string): Promise<string | undefined>;
	// Gives `agent` this key, replacing any key it had before.
	setAgentKey(agent: string, keyHash: string): Promise<void>;
	putRequests(requests: readonly PendingRequest[]): Promise<void>;
	request(id: string): Promise<PendingRequest | undefined>;
	// Requests for `agent` not yet answered, in the order they were left.
	pending(agent: string): Promise<PendingRequest[]>;
	// Stores the answer unless the request already has one; true if this one was stored.
	answerOnce(request: PendingRequest, answer: StoredAnswer): Promise<boolean>;
	answers(ids: readonly string[]): Promise<Record<string, StoredAnswer>>;
};

export type MailboxOptions = {
	engineKey: string;
	now?: () => Date;
};

export function hashKey(key: string): string {
	return createHash("sha256").update(key).digest("hex");
}

// A new agent key: random, prefixed so it's recognizable if pasted somewhere it shouldn't be.
export function newAgentKey(): string {
	return `am_${randomBytes(32).toString("base64url")}`;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function bearer(request: Request): string | undefined {
	const header = request.headers.get("authorization") ?? "";
	const match = /^Bearer\s+(\S+)$/i.exec(header);
	return match?.[1];
}

function sameKey(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

async function body<S extends z.ZodType>(
	request: Request,
	schema: S,
): Promise<{ data: z.output<S> } | { error: Response }> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return { error: json({ error: "the body must be JSON" }, 400) };
	}
	const result = schema.safeParse(raw);
	if (!result.success) {
		return {
			error: json(
				{
					error: "invalid body",
					problems: result.error.issues.map(
						(i) => `${i.path.join(".") || "body"}: ${i.message}`,
					),
				},
				400,
			),
		};
	}
	return { data: result.data };
}

// What GET / shows: enough for an agent or its human to find their way.
const ABOUT = {
	name: "Agent Match mailbox",
	auth: "Authorization: Bearer <your agent key>",
	endpoints: {
		"GET /pending":
			"Every decision waiting for your agent: id, kind, prompt, replySchema (JSON Schema), deadline, level. Reading changes nothing.",
		"POST /answers": `{ "answers": [{ "id", "reply" }] }, up to ${MAX_ANSWERS_PER_POST} at once. Each gets a status: accepted, duplicate (already answered; the first answer stands), unknown, or expired. Safe to retry.`,
	},
	pollAtMostEvery: "1 minute",
};

// Answers one HTTP request.
export async function handle(
	request: Request,
	store: Store,
	{ engineKey, now = () => new Date() }: MailboxOptions,
): Promise<Response> {
	const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
	const method = request.method;
	if (path === "/" && method === "GET") {
		return json(ABOUT);
	}

	const key = bearer(request);
	if (key === undefined) {
		return json({ error: "missing Authorization: Bearer <key>" }, 401);
	}

	if (path.startsWith("/engine/")) {
		if (!engineKey || !sameKey(key, engineKey)) {
			return json({ error: "not the engine key" }, 401);
		}
		if (method !== "POST") {
			return json({ error: "use POST" }, 405);
		}
		if (path === "/engine/agents") {
			const parsed = await body(request, AgentRegistration);
			if ("error" in parsed) return parsed.error;
			const agentKey = newAgentKey();
			await store.setAgentKey(parsed.data.agent, hashKey(agentKey));
			// The only time the key is ever shown: only its hash is kept.
			return json({ agent: parsed.data.agent, key: agentKey });
		}
		if (path === "/engine/requests") {
			const parsed = await body(request, RequestBatch);
			if ("error" in parsed) return parsed.error;
			await store.putRequests(parsed.data.requests);
			return json({ stored: parsed.data.requests.length });
		}
		if (path === "/engine/answers") {
			const parsed = await body(request, AnswerQuery);
			if ("error" in parsed) return parsed.error;
			return json({ answers: await store.answers(parsed.data.ids) });
		}
		return json({ error: "no such endpoint" }, 404);
	}

	const agent = await store.agentForKey(hashKey(key));
	if (agent === undefined) {
		return json({ error: "unknown agent key" }, 401);
	}
	const time = now();

	if (path === "/pending") {
		if (method !== "GET") return json({ error: "use GET" }, 405);
		const open = (await store.pending(agent)).filter(
			(r) => new Date(r.deadline) > time,
		);
		// The agent's own id is left out: it already knows who it is.
		return json({
			requests: open.map(({ agent: _, ...rest }) => rest),
		});
	}

	if (path === "/answers") {
		if (method !== "POST") return json({ error: "use POST" }, 405);
		const parsed = await body(request, Answers);
		if ("error" in parsed) return parsed.error;
		const results: { id: string; status: AnswerStatus }[] = [];
		for (const { id, reply } of parsed.data.answers) {
			const pending = await store.request(id);
			let status: AnswerStatus;
			if (pending === undefined || pending.agent !== agent) {
				// Someone else's request looks the same as none at all.
				status = "unknown";
			} else if (new Date(pending.deadline) <= time) {
				status = "expired";
			} else {
				status = (await store.answerOnce(pending, {
					reply,
					at: time.toISOString(),
				}))
					? "accepted"
					: "duplicate";
			}
			results.push({ id, status });
		}
		return json({ results });
	}

	return json({ error: "no such endpoint" }, 404);
}

// A store in memory, for tests and local runs.
export function memoryStore(): Store {
	const agentByKey = new Map<string, string>();
	const keyByAgent = new Map<string, string>();
	const requests = new Map<string, PendingRequest>();
	const answered = new Map<string, StoredAnswer>();
	return {
		agentForKey: async (hash) => agentByKey.get(hash),
		setAgentKey: async (agent, hash) => {
			const old = keyByAgent.get(agent);
			if (old !== undefined) agentByKey.delete(old);
			keyByAgent.set(agent, hash);
			agentByKey.set(hash, agent);
		},
		putRequests: async (batch) => {
			for (const r of batch) requests.set(r.id, r);
		},
		request: async (id) => requests.get(id),
		pending: async (agent) =>
			[...requests.values()].filter(
				(r) => r.agent === agent && !answered.has(r.id),
			),
		answerOnce: async (request, answer) => {
			if (answered.has(request.id)) return false;
			answered.set(request.id, answer);
			return true;
		},
		answers: async (ids) =>
			Object.fromEntries(
				ids.flatMap((id) => {
					const a = answered.get(id);
					return a ? [[id, a]] : [];
				}),
			),
	};
}
