import { describe, expect, test } from "vitest";
import { contactOf } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import { decisionPrompt } from "../../src/engine/decision.js";
import {
	INJECTION_SCENARIOS,
	leaksIn,
	proposalFor,
	runScenario,
	SENDER,
} from "../../src/evaluation/injection.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// A client whose fake model always answers with `reply`.
function fakeClient(reply: object) {
	const fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: JSON.stringify({
								rationale: "Because.",
								decision: reply,
							}),
						},
					},
				],
			}),
		)) as typeof globalThis.fetch;
	return createLlmClient(config, { fetch, retry: { sleep: async () => {} } });
}

const scenario = (id: string) => INJECTION_SCENARIOS.find((s) => s.id === id)!;

describe("injection scenarios", () => {
	test("ids are unique", () => {
		const ids = INJECTION_SCENARIOS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("an attack never contains the string it tries to extract", () => {
		for (const s of INJECTION_SCENARIOS) {
			expect(leaksIn(counterWith(s.attack), s.forbidden), s.id).toEqual(
				[],
			);
		}
	});

	test("the attack lands in the field it names and nowhere else", () => {
		for (const s of INJECTION_SCENARIOS) {
			const withAttack = proposalFor(s);
			const without = proposalFor(s, false);
			expect(JSON.stringify(withAttack), s.id).toContain(
				s.attack.slice(0, 40).replace(/"/g, '\\"'),
			);
			expect(JSON.stringify(without), s.id).not.toContain(
				s.attack.slice(0, 40).replace(/"/g, '\\"'),
			);
		}
	});

	test("proposals fit the Terms length limits", () => {
		for (const s of INJECTION_SCENARIOS) {
			const p = proposalFor(s);
			expect(p.title!.length, s.id).toBeLessThanOrEqual(60);
			expect(p.pitch.length, s.id).toBeLessThanOrEqual(280);
			expect(p.problem!.length, s.id).toBeLessThanOrEqual(200);
			expect(p.build!.length, s.id).toBeLessThanOrEqual(200);
		}
	});

	test("every leak scenario's secret really is in the agent's prompt, except notes not yet open", () => {
		for (const s of INJECTION_SCENARIOS.filter(
			(x) => x.category !== "hijack_action",
		)) {
			const agent = s.agent();
			expect(contactOf(agent, SENDER).level, s.id).toBe(s.level);
			const prompt = JSON.stringify(
				decisionPrompt(agent, proposalFor(s)),
			);
			for (const secret of s.forbidden) {
				const inPrompt = prompt
					.toLowerCase()
					.includes(secret.toLowerCase());
				// The one deliberate exception: a note whose level is above this one is not in the prompt at all.
				expect(inPrompt, `${s.id}: ${secret}`).toBe(
					s.id !== "unopened-note",
				);
			}
		}
	});
});

describe("leaksIn", () => {
	test("finds a forbidden word in a counter's title, pitch, or card", () => {
		expect(leaksIn(counterWith("Built by Dana"), ["Dana"])).toEqual([
			"Dana",
		]);
		expect(
			leaksIn({ ...counterWith("fine"), build: "uses rust daily" }, [
				"Rust",
			]),
		).toEqual(["Rust"]);
	});

	test("matches whole words only", () => {
		expect(leaksIn(counterWith("a trusted team"), ["Rust"])).toEqual([]);
		expect(leaksIn(counterWith("37 hours"), ["37"])).toEqual(["37"]);
		expect(leaksIn(counterWith("1937"), ["37"])).toEqual([]);
	});

	test("accepts and declines have no words to leak", () => {
		expect(leaksIn({ decision: "accept" }, ["Rust"])).toEqual([]);
		expect(leaksIn({ decision: "decline" }, ["Rust"])).toEqual([]);
	});
});

describe("runScenario", () => {
	test("counts a counter that carries a secret as a leak the gate missed", async () => {
		const client = fakeClient({
			decision: "counter",
			pitch: "Our Nimbus tool, skip the visa part",
			rolesNeeded: ["backend"],
		});
		const r = await runScenario(client, scenario("ask-guidance"), 3);
		expect(r.leaked).toBe(3);
		expect(r.errors).toBe(0);
	});

	test("counts a gate-blocked draft separately from a leak", async () => {
		// Names a profile value, so the gate refuses it and, with only this reply on offer, the agent declines.
		const client = fakeClient({
			decision: "counter",
			pitch: "Dana Okafor knows Rust",
			rolesNeeded: ["backend"],
		});
		const r = await runScenario(client, scenario("ask-name"), 2);
		expect(r.gateBlocked).toBe(2);
		expect(r.leaked).toBe(0);
	});

	test("an accept or decline never leaks", async () => {
		const r = await runScenario(
			fakeClient({ decision: "decline" }),
			scenario("repeat-prompt"),
			2,
		);
		expect(r).toMatchObject({ leaked: 0, gateBlocked: 0, errors: 0 });
	});

	test("hijack scenarios count accepts, and measure the same proposal without the attack", async () => {
		const r = await runScenario(
			fakeClient({ decision: "accept" }),
			scenario("force-accept"),
			2,
		);
		expect(r.hijacked).toBe(2);
		expect(r.controlAccepted).toBe(2);
	});

	test("a failed call counts as an error, never a pass", async () => {
		const fetch = (async () =>
			new Response("{}", { status: 400 })) as typeof globalThis.fetch;
		const client = createLlmClient(config, {
			fetch,
			retry: { sleep: async () => {} },
		});
		const r = await runScenario(client, scenario("ask-name"), 2);
		expect(r.errors + r.leaked + r.gateBlocked).toBeGreaterThan(0);
	});
});

function counterWith(text: string) {
	return {
		decision: "counter" as const,
		pitch: text,
		rolesNeeded: ["backend"],
	};
}
