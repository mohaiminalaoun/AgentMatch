import { describe, expect, test } from "vitest";
import { contactOf } from "../../src/engine/agent.js";
import type { BusEvent } from "../../src/engine/bus.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import type { Profile } from "../../src/engine/profile.js";
import { STANDARD_REFUSAL } from "../../src/engine/proposal.js";
import { createWorld, proposalFrom, runRound } from "../../src/engine/round.js";
import { person, sampleProfile } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// Ada (the sample profile) proposes; three people receive.
const ada = sampleProfile;
// Each receiver gets their own project idea; person() otherwise copies the sample profile's.
const withIdea = (p: Profile, title: string): Profile => ({
	...p,
	projectIdeas: [{ title, description: `${title}, as a hackathon project.` }],
});
const ben = withIdea(
	person("ben", [{ name: "backend", level: "expert" }], ["climate"], -5),
	"City emissions tracker",
);
const kemi = withIdea(
	person("kemi", [{ name: "frontend", level: "expert" }], ["education"], 1),
	"Accessible study tools",
);
const omar = withIdea(
	person("omar", [{ name: "ml", level: "expert" }], ["finance"], 5.5),
	"Open-source risk dashboard",
);

const decisions: Record<string, object> = {
	ben: { decision: "decline" },
	kemi: {
		decision: "counter",
		pitch: "Carbon tracker: Estimate a household's footprint from receipts, for schools.",
		rolesNeeded: ["frontend"],
	},
	omar: { decision: "accept" },
};

// A client whose fake model decides by who is asking (found in the profile in the prompt),
// optionally after a random delay so replies finish in a random order.
function fakeClient(randomDelays = false) {
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string);
		const receiver = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
		if (randomDelays) {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.random() * 20),
			);
		}
		const content = JSON.stringify({
			rationale: `Private reasoning for ${receiver}.`,
			decision: decisions[receiver],
		});
		return new Response(
			JSON.stringify({
				choices: [{ message: { content } }],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 20,
					total_tokens: 120,
				},
			}),
		);
	}) as typeof globalThis.fetch;
	return createLlmClient(config, { fetch, retry: { sleep: async () => {} } });
}

// A world, Ada's proposals to everyone else, and a list recording every bus event.
function setup() {
	const world = createWorld([ada, ben, kemi, omar]);
	const events: BusEvent[] = [];
	world.bus.subscribe((event) => events.push(event));
	const proposals = ["ben", "kemi", "omar"].map((to, i) =>
		proposalFrom(world.agents[ada.id]!, to, `prop-${i + 1}`)!,
	);
	return { world, events, proposals };
}

// Each event as "from → to: kind", for comparing the order of events.
const summary = (events: BusEvent[]) =>
	events.map((e) =>
		e.type === "sent"
			? `${e.message.from} → ${e.message.to}: ${"decision" in e.message ? e.message.decision : "proposal"}`
			: `rejected: ${e.reason}`,
	);

describe("proposalFrom", () => {
	test("pitches the proposer's first project idea and asks for the core roles they lack", () => {
		const { world } = setup();
		const proposal = proposalFrom(world.agents[ada.id]!, "ben", "prop-1");
		expect(proposal).toEqual({
			id: "prop-1",
			from: ada.id,
			to: "ben",
			pitch: "Carbon tracker: Estimate a household's footprint from receipts.",
			rolesNeeded: ["frontend", "backend", "product"],
		});
	});

	test("someone with no project idea has nothing public to pitch", () => {
		const world = createWorld([{ ...ada, projectIdeas: [] }, ben]);
		expect(
			proposalFrom(world.agents[ada.id]!, "ben", "prop-1"),
		).toBeUndefined();
	});
});

describe("runRound", () => {
	test("one proposal and its response go through the bus, in that order", async () => {
		const { world, events, proposals } = setup();
		await runRound(world, fakeClient(), [proposals[0]!]);
		expect(summary(events)).toEqual([
			`${ada.id} → ben: proposal`,
			`ben → ${ada.id}: decline`,
		]);
	});

	test("both agents remember the exchange, in order", async () => {
		const { world, proposals } = setup();
		const { world: after } = await runRound(world, fakeClient(), [
			proposals[0]!,
		]);
		const adaSide = contactOf(after.agents[ada.id]!, "ben").history;
		const benSide = contactOf(after.agents.ben!, ada.id).history;
		expect(adaSide).toEqual(benSide);
		expect(
			adaSide.map((m) => ("decision" in m ? m.decision : "proposal")),
		).toEqual(["proposal", "decline"]);
	});

	test("a decline goes out with the standard refusal", async () => {
		const { world, proposals } = setup();
		const { report } = await runRound(world, fakeClient(), [proposals[0]!]);
		expect(report[0]!.response).toMatchObject({
			decision: "decline",
			reason: STANDARD_REFUSAL,
		});
	});

	test("what each side revealed is recorded", async () => {
		const { world, proposals } = setup();
		const { world: after } = await runRound(world, fakeClient(), proposals);
		expect(contactOf(after.agents[ada.id]!, "ben").revealed).toEqual([
			"projectIdeas",
		]);
		expect(contactOf(after.agents.ben!, ada.id).revealed).toEqual([]);
		// Kemi's counter pitch repeats Ada's idea, not anything of Kemi's.
		expect(contactOf(after.agents.kemi!, ada.id).revealed).toEqual([]);
	});

	test("the private rationale is in the report but never on the bus", async () => {
		const { world, events, proposals } = setup();
		const { report } = await runRound(world, fakeClient(), proposals);
		expect(report.map((r) => r.result.rationale)).toEqual([
			"Private reasoning for ben.",
			"Private reasoning for kemi.",
			"Private reasoning for omar.",
		]);
		expect(JSON.stringify(events)).not.toContain("Private reasoning");
	});

	test("the bus order is the same however the model's replies are timed", async () => {
		const orders = new Set<string>();
		for (let run = 0; run < 5; run++) {
			const { world, events, proposals } = setup();
			await runRound(world, fakeClient(true), proposals);
			orders.add(JSON.stringify(summary(events)));
		}
		expect(orders.size).toBe(1);
		expect(JSON.parse([...orders][0]!)).toEqual([
			`${ada.id} → ben: proposal`,
			`${ada.id} → kemi: proposal`,
			`${ada.id} → omar: proposal`,
			`ben → ${ada.id}: decline`,
			`kemi → ${ada.id}: counter`,
			`omar → ${ada.id}: accept`,
		]);
	});

	test("every inbox is empty after the round", async () => {
		const { world, proposals } = setup();
		const { world: after } = await runRound(world, fakeClient(), proposals);
		for (const id of Object.keys(after.agents)) {
			expect(after.bus.receive(id)).toEqual([]);
		}
	});

	test("the world passed in is left unchanged", async () => {
		const { world, proposals } = setup();
		const before = JSON.stringify(world.agents);
		const { world: after } = await runRound(world, fakeClient(), proposals);
		expect(JSON.stringify(world.agents)).toBe(before);
		expect(after.agents).not.toBe(world.agents);
	});
});

describe("prompt isolation", () => {
	test("an agent's prompts never contain anyone else's private data", async () => {
		// Kemi carries unique markers in every private field; Ada's private skill is "typescript".
		const marked: Profile = {
			...kemi,
			name: "ZzKemiName",
			skills: [{ name: "zz-secret-skill", level: "expert" }],
			interests: ["zz-secret-interest"],
		};
		const world = createWorld([ada, ben, marked]);
		const promptsFor: Record<string, string[]> = {};
		// Records every prompt by who it was built for, then declines.
		const fetch = (async (_url: unknown, init?: RequestInit) => {
			const body = init!.body as string;
			const receiver = /"id": "(\w+)"/.exec(
				JSON.parse(body).messages[1].content,
			)![1]!;
			(promptsFor[receiver] ??= []).push(body);
			const content = JSON.stringify({
				rationale: "Not a fit.",
				decision: { decision: "decline" },
			});
			return new Response(
				JSON.stringify({ choices: [{ message: { content } }] }),
			);
		}) as typeof globalThis.fetch;
		const client = createLlmClient(config, { fetch });

		// Kemi is in the same round, deciding at the same time as Ben.
		const proposals = ["ben", "kemi"].map((to, i) =>
			proposalFrom(world.agents[ada.id]!, to, `prop-${i + 1}`)!,
		);
		await runRound(world, client, proposals);

		const benPrompts = promptsFor.ben!.join("\n");
		for (const secret of [
			"zz-secret-skill",
			"zz-secret-interest",
			"ZzKemiName",
		]) {
			expect(benPrompts).not.toContain(secret);
		}
		// The proposer's private data doesn't reach the receiver either, only the public pitch.
		expect(benPrompts).not.toContain("typescript");
		expect(benPrompts).toContain("Carbon tracker");
		// The test only means something if Kemi's own prompt did contain her markers.
		expect(promptsFor.kemi!.join("\n")).toContain("zz-secret-skill");
	});
});
