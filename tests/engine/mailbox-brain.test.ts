import { describe, expect, test } from "vitest";
import { handle, hashKey, memoryStore } from "../../mailbox/api/_mailbox.js";
import { createAgent } from "../../src/engine/agent.js";
import { createLlmClient, withBrains } from "../../src/engine/client.js";
import { decideOnProposal } from "../../src/engine/decision.js";
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
function arena(replies: object[]) {
	const store = memoryStore();
	void store.setAgentKey(sampleProfile.id, hashKey(AGENT_KEY));
	let now = START;
	const seen: Seen[] = [];
	const fetch = ((input: string | URL | Request, init?: RequestInit) =>
		handle(new Request(input, init), store, {
			engineKey: ENGINE,
			now: () => now,
		})) as typeof globalThis.fetch;
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
	const brain = createMailboxBrain(
		{ url: "https://mailbox.test", engineKey: ENGINE },
		{
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
	return { decide, seen, exchanges };
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
		const { decide, seen } = arena([
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
		expect(seen).toHaveLength(2);
		expect(seen[1]!.prompt).toContain("Your reply was invalid");
		expect(seen[1]!.prompt).toMatch(/climate/);
	});

	test("with no answer by the deadline, the call site's safe default is used: a plain decline", async () => {
		const { decide, seen } = arena([]);
		const result = await decide();
		expect(result).toMatchObject({
			decision: { decision: "decline" },
			fellBack: true,
		});
		expect(seen).toHaveLength(1);
	});
});
