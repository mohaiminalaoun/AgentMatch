import { describe, expect, test } from "vitest";
import { createAgent, raiseLevel } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import { decideOnProposal } from "../../src/engine/decision.js";
import type { RunEvent } from "../../src/engine/events.js";
import {
	getHunch,
	hunchMessages,
	steerText,
	type Hunch,
} from "../../src/engine/hunch.js";
import { checkInterest } from "../../src/engine/interest.js";
import type { Note } from "../../src/engine/notes.js";
import type { Profile } from "../../src/engine/profile.js";
import { createWorld, proposalFrom, runRound } from "../../src/engine/round.js";
import { person, sampleProfile } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// A "never" note with a word that can't appear by accident.
const deep: Note[] = [
	{ text: "Built a zzjitsu app that died after two weeks.", level: "never" },
];
const ada = createAgent(sampleProfile, deep);
const proposal = {
	id: "p1",
	from: "p9",
	to: sampleProfile.id,
	pitch: "A fitness app for building workout habits.",
	rolesNeeded: ["mobile"],
};
const careful: Hunch = {
	steer: "careful",
	riskArea: "retention",
	rationale: "Their zzjitsu app lost users fast.",
	fellBack: false,
};

// A client whose fake model gives each reply in turn (repeating the last), recording every prompt.
function fakeModel(...replies: object[]) {
	const sent: string[] = [];
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		sent.push(init!.body as string);
		const reply = replies[Math.min(sent.length, replies.length) - 1];
		return new Response(
			JSON.stringify({
				choices: [{ message: { content: JSON.stringify(reply) } }],
			}),
		);
	}) as typeof globalThis.fetch;
	const client = createLlmClient(config, {
		fetch,
		retry: { sleep: async () => {} },
	});
	return Object.assign(client, { sent });
}

describe("getHunch", () => {
	test("an agent without 'never' notes gets no hunch, and no call is made", async () => {
		const client = fakeModel({});
		expect(
			await getHunch(client, createAgent(sampleProfile), "p9", "x"),
		).toBeUndefined();
		expect(client.sent).toHaveLength(0);
	});

	test("the hunch call sees every note, 'never' ones included", () => {
		expect(JSON.stringify(hunchMessages(ada, "p9", "x"))).toContain(
			"zzjitsu",
		);
	});

	test("returns the steer and risk area, keeping a risk area only for careful", async () => {
		expect(
			await getHunch(
				fakeModel({
					rationale: "r",
					steer: "careful",
					riskArea: "retention",
				}),
				ada,
				"p9",
				"x",
			),
		).toMatchObject({ steer: "careful", riskArea: "retention" });
		expect(
			await getHunch(
				fakeModel({
					rationale: "r",
					steer: "explore",
					riskArea: "market",
				}),
				ada,
				"p9",
				"x",
			),
		).toMatchObject({ steer: "explore", riskArea: null });
	});

	test("falls back to neutral if no valid answer comes back", async () => {
		expect(
			await getHunch(fakeModel({ steer: "panic" }), ada, "p9", "x"),
		).toMatchObject({ steer: "neutral", fellBack: true });
	});
});

describe("steerText", () => {
	test("is fixed text naming only the steer and risk area", () => {
		expect(steerText(careful, "decision")).toBe(
			"Your human has private reasons for caution about this, especially around retention. Don't accept it as is: counter with a question or change that addresses it, or decline.",
		);
		expect(
			steerText({ ...careful, steer: "neutral" }, "decision"),
		).toBeUndefined();
		expect(steerText(undefined, "interest")).toBeUndefined();
	});
});

describe("a hunch steering a decision", () => {
	const accept = { rationale: "Fits.", decision: { decision: "accept" } };
	const counter = {
		rationale: "Probe it.",
		decision: {
			decision: "counter",
			pitch: "A fitness app, with a plan to keep users coming back after the first weeks.",
			rolesNeeded: ["mobile"],
		},
	};

	test("careful: the decision prompt gets the fixed sentence, never the note, and a plain accept is refused", async () => {
		const client = fakeModel(accept, counter);
		const result = await decideOnProposal(
			client,
			ada,
			proposal,
			{},
			careful,
		);
		expect(result.decision.decision).toBe("counter");
		expect(client.sent[0]).toContain("especially around retention");
		expect(client.sent.join("")).not.toContain("zzjitsu");
		expect(client.sent[1]).toContain("private reasons for caution");
	});

	test("stop: declines with no call", async () => {
		const client = fakeModel(accept);
		const result = await decideOnProposal(
			client,
			ada,
			proposal,
			{},
			{
				...careful,
				steer: "stop",
			},
		);
		expect(result.decision).toEqual({ decision: "decline" });
		expect(result.fellBack).toBe(false);
		expect(client.sent).toHaveLength(0);
	});

	test("an interest check: stop withdraws with no call, explore nudges to continue", async () => {
		const level1 = raiseLevel(ada, "p9", 1);
		const stopped = fakeModel({ rationale: "r", interest: "continue" });
		expect(
			await checkInterest(
				stopped,
				level1,
				"p9",
				1,
				{},
				{
					...careful,
					steer: "stop",
				},
			),
		).toMatchObject({ interest: "withdraw", fellBack: false });
		expect(stopped.sent).toHaveLength(0);

		const explored = fakeModel({ rationale: "r", interest: "continue" });
		await checkInterest(
			explored,
			level1,
			"p9",
			1,
			{},
			{
				...careful,
				steer: "explore",
				riskArea: null,
			},
		);
		expect(explored.sent[0]).toContain(
			"Prefer continuing over withdrawing",
		);
		expect(explored.sent[0]).not.toContain("zzjitsu");
	});
});

describe("in a round", () => {
	test("the 'never' note steers the reply but appears in nothing sent, and the hunch is logged", async () => {
		const lena: Profile = {
			...person(
				"lena",
				[{ name: "mobile", level: "expert" }],
				["fitness"],
				-5,
			),
			projectIdeas: [
				{
					title: "Habit app",
					description: "A fitness app for workout habits.",
				},
			],
		};
		const world = createWorld([lena, sampleProfile], {
			[sampleProfile.id]: deep,
		});
		const fetch = (async (_url: unknown, init?: RequestInit) => {
			const { messages } = JSON.parse(init!.body as string);
			const last: string = messages.at(-1).content;
			const reply = last.includes("What's your steer?")
				? {
						rationale: "zzjitsu again.",
						steer: "careful",
						riskArea: "retention",
					}
				: {
						rationale: "Probe it.",
						decision: {
							decision: "counter",
							pitch: "How would we keep users past the first weeks?",
							rolesNeeded: ["mobile"],
						},
					};
			return new Response(
				JSON.stringify({
					choices: [{ message: { content: JSON.stringify(reply) } }],
				}),
			);
		}) as typeof globalThis.fetch;
		const client = createLlmClient(config, {
			fetch,
			retry: { sleep: async () => {} },
		});
		const events: RunEvent[] = [];
		await runRound(
			world,
			client,
			[proposalFrom(world.agents.lena!, sampleProfile.id, "p1")!],
			{ maxTicks: 1, onEvent: (e) => events.push(e) },
		);
		const sent = events.filter((e) => e.type === "bus");
		expect(JSON.stringify(sent)).not.toContain("zzjitsu");
		expect(JSON.stringify(sent)).toContain("first weeks");
		expect(events.find((e) => e.type === "hunch")).toMatchObject({
			agent: sampleProfile.id,
			steer: "careful",
			riskArea: "retention",
		});
	});
});
