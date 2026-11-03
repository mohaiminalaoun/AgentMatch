import { describe, expect, test } from "vitest";
import { handle, hashKey, memoryStore } from "../../mailbox/api/_mailbox.js";
import { createAgent } from "../../src/engine/agent.js";
import { createLlmClient, withBrains } from "../../src/engine/client.js";
import { decideOnProposal } from "../../src/engine/decision.js";
import { RunEvent, type MailboxDiagnostic } from "../../src/engine/events.js";
import { formatEvent } from "../../src/describe.js";
import { z } from "zod";
import type { Exchange } from "../../src/engine/llm.js";
import {
	createMailboxBrain,
	OUTSIDE_PREFACE,
} from "../../src/engine/mailbox-brain.js";
import type { Proposal } from "../../src/engine/proposal.js";
import { sampleProfile } from "../fixtures.js";

const ENGINE = "engine-key-for-tests";
const AGENT_KEY = "am_agent-key-for-tests";
const START = new Date("2026-11-01T12:00:00Z");

const proposal: Proposal = {
	id: "prop-1",
	from: "p9",
	to: sampleProfile.id,
	pitch: "A web app startup that helps freelancers send invoices.",
	rolesNeeded: ["frontend", "backend"],
};

// Ada's agent, at level 0 with everyone; her interests (climate, education) are level 1.
const ada = createAgent(sampleProfile);

type Seen = {
	id: string;
	kind: string;
	level: number;
	prompt: string;
	replySchema: unknown;
};

// A real mailbox in memory, an outside agent that answers each request with the next of `replies` (or never,
// past the end), and a clock that moves a minute every time the brain waits.
function arena(replies: object[], notifyStatus?: number) {
	const notifications: {
		body: unknown;
		authorization: string | null;
		stored: boolean;
	}[] = [];
	const store = memoryStore();
	void store.setAgentKey(sampleProfile.id, hashKey(AGENT_KEY));
	let now = START;
	const seen: Seen[] = [];
	const fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		if (String(input) === "https://hook.test/wake") {
			const body = JSON.parse(String(init?.body));
			const pending = await store.pending(sampleProfile.id);
			notifications.push({
				body,
				authorization: new Headers(init?.headers).get("authorization"),
				stored: pending.some((r) => r.id === body.request_id),
			});
			return new Response("", { status: notifyStatus ?? 200 });
		}
		return handle(new Request(input, init), store, {
			engineKey: ENGINE,
			now: () => now,
		});
	}) as typeof globalThis.fetch;
	// The outside agent's side: read what's pending and answer it, as Muse's scheduled task does.
	const agentAnswers = async () => {
		const call = (method: string, path: string, body?: unknown) =>
			handle(
				new Request(`https://mailbox.test${path}`, {
					method,
					headers: {
						authorization: `Bearer ${AGENT_KEY}`,
						"content-type": "application/json",
					},
					...(body !== undefined && { body: JSON.stringify(body) }),
				}),
				store,
				{ engineKey: ENGINE, now: () => now },
			).then((r) => r.json());
		const { requests } = await call("GET", "/pending");
		for (const request of requests) {
			// An unanswered request is still pending at the next check; note it once.
			if (seen.some((r) => r.id === request.id)) continue;
			seen.push(request);
			const reply = replies[seen.length - 1];
			if (reply) {
				await call("POST", "/answers", {
					answers: [{ id: request.id, reply }],
				});
			}
		}
	};
	const exchanges: Exchange[] = [];
	const diagnostics: MailboxDiagnostic[] = [];
	const brain = createMailboxBrain(
		{ url: "https://mailbox.test", engineKey: ENGINE },
		{
			onDiagnostic: (event) => diagnostics.push(event),
			...(notifyStatus === undefined
				? {}
				: {
						webhook: {
							url: "https://hook.test/wake",
							key: "webhook-test-secret",
						},
					}),
			agent: sampleProfile.id,
			answerMs: 30 * 60_000,
			pollMs: 60_000,
			runId: "run1",
			fetch,
			now: () => now,
			sleep: async (ms) => {
				now = new Date(now.getTime() + ms);
				await agentAnswers();
			},
		},
	);
	// Everyone else would think with a model; this test never calls it.
	const shared = createLlmClient({
		baseUrl: "https://llm.example.com/v1",
		apiKey: "unused",
		model: "test-model",
		maxConcurrency: 1,
	});
	const client = withBrains(shared, { [sampleProfile.id]: brain });
	const decide = () =>
		decideOnProposal(client, ada, proposal, {
			onExchange: (e) => exchanges.push(e),
		});
	return { decide, seen, exchanges, diagnostics, notifications };
}

describe("createMailboxBrain", () => {
	test("leaves the decision in the mailbox with its kind, level, prompt, and JSON Schema, and uses the answer", async () => {
		const { decide, seen, exchanges } = arena([
			{ rationale: "Fits.", decision: { decision: "accept" } },
		]);
		const result = await decide();
		expect(result).toMatchObject({
			decision: { decision: "accept" },
			rationale: "Fits.",
			fellBack: false,
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ kind: "decision", level: 0 });
		expect(seen[0]!.prompt.startsWith(OUTSIDE_PREFACE)).toBe(true);
		expect(seen[0]!.prompt).toContain(proposal.pitch);
		expect(seen[0]!.replySchema).toMatchObject({
			type: "object",
			required: ["rationale", "decision"],
		});
		expect(exchanges.map((e) => e.model)).toEqual(["mailbox:p1"]);
	});

	test("an answer the gate blocks goes back as a new request with the reason, and the corrected answer is used", async () => {
		const { decide, seen, diagnostics } = arena([
			{
				rationale: "Counter.",
				decision: {
					decision: "counter",
					pitch: "Invoices for climate freelancers.",
					rolesNeeded: ["frontend"],
				},
			},
			{ rationale: "Fine as is.", decision: { decision: "accept" } },
		]);
		const result = await decide();
		expect(result.decision).toEqual({ decision: "accept" });
		expect(result.gateBlocks).toBe(1);
		expect(diagnostics.find((e) => e.status === "retry")).toMatchObject({
			reason: "disclosure_rejection",
			attempt: 1,
		});
		expect(diagnostics.at(-1)).toMatchObject({
			status: "completed",
			attempt: 2,
		});
		expect(seen).toHaveLength(2);
		expect(seen[1]!.prompt).toContain("Your reply was invalid");
		expect(seen[1]!.prompt).toMatch(/climate/);
	});

	test("with no answer by the deadline, the call site's safe default is used: a plain decline", async () => {
		const { decide, seen, diagnostics } = arena([]);
		const result = await decide();
		expect(result).toMatchObject({
			decision: { decision: "decline" },
			fellBack: true,
		});
		expect(seen).toHaveLength(1);
		expect(diagnostics.map((e) => e.status)).toEqual([
			"pending",
			"fallback",
		]);
		expect(diagnostics[1]).toMatchObject({
			reason: "timeout",
			attempt: 1,
			elapsedMs: 30 * 60_000,
			requestId: seen[0]!.id,
			kind: "decision",
			level: 0,
		});
		expect(RunEvent.safeParse(diagnostics[1]).success).toBe(true);
		expect(formatEvent(diagnostics[1]!)).toContain("not an agent decision");
	});
	test("notifies only after storage, with an ID-only payload and a separate credential", async () => {
		const { decide, notifications, diagnostics } = arena(
			[
				{ rationale: "Bad shape" },
				{ rationale: "Good", decision: { decision: "accept" } },
			],
			200,
		);
		expect((await decide()).fellBack).toBe(false);
		expect(notifications).toHaveLength(2);
		for (const n of notifications) {
			expect(Object.keys(n.body as object)).toEqual(["request_id"]);
			expect(n.authorization).toBe("Bearer webhook-test-secret");
			expect(n.stored).toBe(true);
		}
		expect(
			new Set(
				notifications.map(
					(n) => (n.body as { request_id: string }).request_id,
				),
			).size,
		).toBe(2);
		expect(diagnostics.filter((e) => e.status === "notified")).toHaveLength(
			2,
		);
		expect(JSON.stringify(diagnostics)).not.toContain(
			"webhook-test-secret",
		);
	});
	test("notification failure is logged once and does not discard a valid mailbox answer", async () => {
		const { decide, notifications, diagnostics } = arena(
			[{ rationale: "Good", decision: { decision: "accept" } }],
			503,
		);
		expect((await decide()).fellBack).toBe(false);
		expect(notifications).toHaveLength(1);
		expect(
			diagnostics.find((e) => e.status === "notification_failed"),
		).toMatchObject({ reason: "webhook_error" });
		expect(diagnostics.at(-1)?.status).toBe("completed");
	});

	test("keeps simultaneous request IDs and attempt counts separate", async () => {
		const { decide, diagnostics, exchanges } = arena([
			{ rationale: "First", decision: { decision: "accept" } },
			{ rationale: "Second", decision: { decision: "accept" } },
		]);
		const results = await Promise.all([decide(), decide()]);
		expect(results.every((r) => !r.fellBack)).toBe(true);
		const completed = diagnostics.filter((e) => e.status === "completed");
		expect(completed).toHaveLength(2);
		expect(new Set(completed.map((e) => e.requestId)).size).toBe(2);
		expect(completed.every((e) => e.attempt === 1)).toBe(true);
		expect(exchanges.map((e) => e.requestId).sort()).toEqual(
			completed.map((e) => e.requestId).sort(),
		);
	});
	test("logs transient poll failure and later completion without a fallback", async () => {
		const diagnostics: MailboxDiagnostic[] = [];
		let checks = 0;
		let requestId = "";
		const brain = createMailboxBrain(
			{ url: "https://mailbox.test", engineKey: ENGINE },
			{
				agent: "muse",
				runId: "poll",
				answerMs: 480_000,
				pollMs: 1,
				sleep: async () => {},
				onDiagnostic: (e) => diagnostics.push(e),
				fetch: async (url, init) => {
					if (String(url).endsWith("/engine/requests")) {
						requestId = JSON.parse(String(init?.body)).requests[0]
							.id;
						return Response.json({ ok: true });
					}
					if (++checks === 1)
						return new Response("secret-error-body", {
							status: 503,
						});
					return Response.json({
						answers: { [requestId]: { reply: { ok: true } } },
					});
				},
			},
		);
		expect(
			(await brain.chatJson([], z.object({ ok: z.boolean() }))).data.ok,
		).toBe(true);
		expect(diagnostics.map((e) => e.status)).toEqual([
			"pending",
			"poll_error",
			"answered",
			"completed",
		]);
		expect(diagnostics[1]).toMatchObject({
			reason: "mailbox_error",
			requestId,
		});
		expect(JSON.stringify(diagnostics)).not.toContain("secret-error-body");
	});

	test("records schema correction and terminal exhaustion without logging reply data", async () => {
		const { decide, diagnostics } = arena([
			{ secret: "do-not-log" },
			{ secret: "do-not-log" },
			{ secret: "do-not-log" },
		]);
		expect((await decide()).fellBack).toBe(true);
		expect(diagnostics.filter((e) => e.status === "retry")).toHaveLength(2);
		expect(diagnostics.at(-1)).toMatchObject({
			status: "fallback",
			reason: "schema_failure",
			attempt: 3,
		});
		expect(JSON.stringify(diagnostics)).not.toContain("do-not-log");
		expect(JSON.stringify(diagnostics)).not.toContain(ENGINE);
	});
	test("webhook routine fetches full matching requests and submits isolated answers through the real mailbox handler", async () => {
		const store = memoryStore();
		await store.setAgentKey("grokbot", hashKey(AGENT_KEY));
		const diagnostics: MailboxDiagnostic[] = [];
		const fetchedIds: string[] = [];
		const submittedIds: string[] = [];
		const api = async (
			path: string,
			method: string,
			key: string,
			body?: unknown,
		) =>
			handle(
				new Request(`https://mailbox.test${path}`, {
					method,
					headers: {
						authorization: `Bearer ${key}`,
						"content-type": "application/json",
					},
					...(body === undefined
						? {}
						: { body: JSON.stringify(body) }),
				}),
				store,
				{ engineKey: ENGINE, now: () => START },
			);
		const transport = (async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			if (String(input) === "https://hook.test/wake") {
				expect(new Headers(init?.headers).get("authorization")).toBe(
					"Bearer wake-secret",
				);
				const payload = JSON.parse(String(init?.body));
				expect(Object.keys(payload)).toEqual(["request_id"]);
				const pending = await (
					await api("/pending", "GET", AGENT_KEY)
				).json();
				const request = pending.requests.find(
					(r: { id: string }) => r.id === payload.request_id,
				);
				expect(request).toBeDefined();
				expect(request.prompt.length).toBeGreaterThan(8000);
				const token = /END_TOKEN=(one|two)/.exec(request.prompt)?.[1];
				expect(token).toBeDefined();
				fetchedIds.push(request.id);
				const result = await (
					await api("/answers", "POST", AGENT_KEY, {
						answers: [{ id: request.id, reply: { token } }],
					})
				).json();
				expect(result.results).toEqual([
					{ id: request.id, status: "accepted" },
				]);
				submittedIds.push(request.id);
				return Response.json({ ok: true });
			}
			return handle(new Request(input, init), store, {
				engineKey: ENGINE,
				now: () => START,
			});
		}) as typeof fetch;
		const brain = createMailboxBrain(
			{ url: "https://mailbox.test", engineKey: ENGINE },
			{
				agent: "grokbot",
				runId: "integrated",
				answerMs: 480000,
				pollMs: 2000,
				now: () => START,
				sleep: async () => {},
				fetch: transport,
				webhook: { url: "https://hook.test/wake", key: "wake-secret" },
				onDiagnostic: (e) => diagnostics.push(e),
			},
		);
		const results = await Promise.all(
			["one", "two"].map((token) =>
				brain.chatJson(
					[
						{
							role: "user",
							content: "x".repeat(8100) + ` END_TOKEN=${token}`,
						},
					],
					z.object({ token: z.enum(["one", "two"]) }),
					{
						about: { kind: "discovery", level: 0 },
						check: (reply) =>
							reply.token === token
								? []
								: ["wrong request context"],
					},
				),
			),
		);
		expect(results.map((r) => r.data.token)).toEqual(["one", "two"]);
		expect(new Set(fetchedIds).size).toBe(2);
		expect(submittedIds.sort()).toEqual(fetchedIds.sort());
		expect(
			diagnostics.filter((e) => e.status === "completed"),
		).toHaveLength(2);
		expect(diagnostics.some((e) => e.status === "fallback")).toBe(false);
		expect(JSON.stringify(diagnostics)).not.toContain(AGENT_KEY);
		expect(JSON.stringify(diagnostics)).not.toContain("wake-secret");
	});

	test("records mailbox submission errors separately from deadline expiry", async () => {
		const diagnostics: MailboxDiagnostic[] = [];
		const brain = createMailboxBrain(
			{ url: "https://mailbox.test", engineKey: ENGINE },
			{
				agent: "muse",
				answerMs: 480_000,
				runId: "outage",
				now: () => START,
				fetch: async () =>
					new Response("sensitive upstream body", { status: 503 }),
				onDiagnostic: (e) => diagnostics.push(e),
			},
		);
		await expect(
			brain.chatJson([], z.object({ ok: z.boolean() }), {
				about: { kind: "interest", level: 2 },
			}),
		).rejects.toThrow("mailbox could not take");
		expect(diagnostics.at(-1)).toMatchObject({
			status: "fallback",
			reason: "mailbox_error",
			kind: "interest",
			level: 2,
			attempt: 1,
			elapsedMs: 0,
		});
		expect(JSON.stringify(diagnostics)).not.toContain("sensitive");
	});
});
