import { describe, expect, test } from "vitest";
import {
	contactOf,
	createAgent,
	learn,
	raiseLevel,
	recordMessage,
} from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import {
	decideOnProposal,
	decisionMessages,
} from "../../src/engine/decision.js";
import type { Message } from "../../src/engine/llm.js";
import type { Proposal } from "../../src/engine/proposal.js";
import { sampleProfile } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

const proposal: Proposal = {
	id: "prop-1",
	from: "p9",
	to: sampleProfile.id,
	pitch: "A web app startup that helps freelancers send invoices.",
	rolesNeeded: ["frontend", "backend"],
};

// Ada's agent, at level 0 with everyone.
const ada = createAgent(sampleProfile);

// A client whose fake model gives each reply in turn (repeating the last), recording what it was sent.
function fakeModel(...replies: object[]) {
	const sent: Message[][] = [];
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		sent.push(JSON.parse(init!.body as string).messages);
		const reply = replies[Math.min(sent.length, replies.length) - 1];
		return new Response(
			JSON.stringify({
				choices: [{ message: { content: JSON.stringify(reply) } }],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 20,
					total_tokens: 120,
				},
			}),
		);
	}) as typeof globalThis.fetch;
	const client = createLlmClient(config, {
		fetch,
		retry: { sleep: async () => {} },
	});
	return { client, sent };
}

const counter = (pitch: string) => ({
	rationale: "Partial fit.",
	decision: { decision: "counter", pitch, rolesNeeded: ["frontend"] },
});

describe("decisionMessages", () => {
	test("includes the human's full profile for the model's judgment", () => {
		const [system] = decisionMessages(ada, proposal);
		expect(system!.content).toContain('"typescript"');
		expect(system!.content).toContain(sampleProfile.projectIdeas[0]!.title);
	});

	test("states the disclosure rules for the current level", () => {
		const [system] = decisionMessages(ada, proposal);
		expect(system!.content).toContain("you are at level 0 with this agent");
		expect(system!.content).toMatch(
			/you may mention: your human's project ideas\./,
		);
		expect(system!.content).toMatch(
			/Never mention: .*skills or experience/,
		);
	});

	test("the rules loosen as the level rises", () => {
		const [system] = decisionMessages(
			raiseLevel(ada, proposal.from, 2),
			proposal,
		);
		expect(system!.content).toMatch(
			/you may mention: .*skills or experience/,
		);
		expect(system!.content).toMatch(/Never mention: your human's name\./);
	});

	test("includes the proposal and what's known about the sender", () => {
		const knowing = learn(ada, proposal.from, { interests: ["music"] });
		const [, user] = decisionMessages(knowing, proposal);
		expect(user!.content).toContain(proposal.pitch);
		expect(user!.content).toContain("frontend, backend");
		expect(user!.content).toContain('"music"');
	});
});

describe("decideOnProposal", () => {
	test("returns the decision to send and the private rationale", async () => {
		const { client } = fakeModel({
			rationale: "Ada wants climate work; invoicing doesn't fit.",
			decision: { decision: "decline" },
		});
		const result = await decideOnProposal(client, ada, proposal);
		expect(result.decision).toEqual({ decision: "decline" });
		expect(result.rationale).toBe(
			"Ada wants climate work; invoicing doesn't fit.",
		);
		expect(result.gateBlocks).toBe(0);
		expect(result.fellBack).toBe(false);
	});

	test("the rationale is never part of what gets sent", async () => {
		const { client } = fakeModel({
			rationale: "Ada is a typescript expert.",
			decision: { decision: "accept" },
		});
		const result = await decideOnProposal(client, ada, proposal);
		expect(JSON.stringify(result.decision)).not.toContain("typescript");
	});

	test("a counter that reveals too much is redrafted with the gate's feedback", async () => {
		const { client, sent } = fakeModel(
			counter("Ada is a typescript expert; make it a climate app."),
			counter("Make it a household carbon tracker instead."),
		);
		const result = await decideOnProposal(client, ada, proposal);
		expect(result.decision).toEqual({
			decision: "counter",
			pitch: "Make it a household carbon tracker instead.",
			rolesNeeded: ["frontend"],
		});
		expect(result.gateBlocks).toBe(1);
		const feedback = sent[1]!.at(-1)!;
		expect(feedback.role).toBe("user");
		expect(feedback.content).toContain("skills or experience");
		expect(feedback.content).toContain('"typescript"');
	});

	test("a counter blocked every time falls back to a plain decline", async () => {
		const { client, sent } = fakeModel(counter("Ada knows typescript."));
		const result = await decideOnProposal(client, ada, proposal);
		expect(result.decision).toEqual({ decision: "decline" });
		expect(result.fellBack).toBe(true);
		expect(result.gateBlocks).toBe(3);
		expect(sent).toHaveLength(3);
	});

	test("a reason the model adds to a decline is stripped, with no extra call", async () => {
		const { client, sent } = fakeModel({
			rationale: "Not a fit.",
			decision: {
				decision: "decline",
				reason: "My human is a typescript expert who wants climate work.",
			},
		});
		const result = await decideOnProposal(client, ada, proposal);
		expect(result.decision).toEqual({ decision: "decline" });
		expect(result.gateBlocks).toBe(0);
		expect(result.fellBack).toBe(false);
		expect(sent).toHaveLength(1);
	});

	test("the prompt tells the model to counter rather than explain a decline", () => {
		const [system] = decisionMessages(ada, proposal);
		expect(system!.content).toContain("Declines carry no message");
		expect(system!.content).toContain("counter instead");
	});

	test("the same text passes once the level allows it", async () => {
		// The skill is allowed at level 2; the name would still be blocked until level 3.
		const { client } = fakeModel(counter("My human knows typescript."));
		const atTwo = raiseLevel(ada, proposal.from, 2);
		const result = await decideOnProposal(client, atTwo, proposal);
		expect(result.decision.decision).toBe("counter");
		expect(result.gateBlocks).toBe(0);
	});

	test("a reply that never matches the schema falls back to a plain decline", async () => {
		const { client } = fakeModel({ decision: "maybe" });
		const result = await decideOnProposal(client, ada, proposal);
		expect(result.decision).toEqual({ decision: "decline" });
		expect(result.fellBack).toBe(true);
		expect(result.rationale).toBeUndefined();
	});

	test("deciding doesn't change the agent's state; that's the caller's job", async () => {
		const { client } = fakeModel({
			rationale: "Fits.",
			decision: { decision: "accept" },
		});
		await decideOnProposal(client, ada, proposal);
		expect(contactOf(ada, proposal.from).history).toEqual([]);
	});

	test("a counter listing your own role is redrafted, and the feedback names the roles list", async () => {
		const { client, sent } = fakeModel(
			{
				rationale: "Partial fit.",
				decision: {
					decision: "counter",
					pitch: "Make it a household carbon tracker instead.",
					rolesNeeded: ["frontend", "backend"],
				},
			},
			counter("Make it a household carbon tracker instead."),
		);
		const result = await decideOnProposal(client, ada, proposal);
		expect(result.gateBlocks).toBe(1);
		expect(result.decision).toMatchObject({ rolesNeeded: ["frontend"] });
		const feedback = sent[1]!.at(-1)!.content;
		expect(feedback).toContain("your roles needed list mentions");
		expect(feedback).toContain('"backend"');
	});

	test("after two counters, a third is refused and the model must accept or decline", async () => {
		let agent = ada;
		for (const pitch of ["Version one.", "Version two."]) {
			agent = recordMessage(agent, "p9", {
				decision: "counter",
				proposalId: "prop-1",
				from: "p9",
				to: sampleProfile.id,
				pitch,
				rolesNeeded: ["frontend"],
			});
		}
		const { client, sent } = fakeModel(counter("Version three."), {
			rationale: "Close enough.",
			decision: { decision: "accept" },
		});
		const result = await decideOnProposal(client, agent, proposal);
		expect(result.decision).toEqual({ decision: "accept" });
		expect(result.gateBlocks).toBe(0);
		expect(sent[0]!.at(-1)!.content).toContain("accept or decline");
		expect(sent[1]!.at(-1)!.content).toContain("no counters are left");
	});

	test("before the limit, counters are allowed and the prompt doesn't mention it", async () => {
		const { client, sent } = fakeModel(counter("Version one."));
		const result = await decideOnProposal(client, ada, proposal);
		expect(result.decision.decision).toBe("counter");
		expect(sent[0]!.at(-1)!.content).not.toContain("counters");
	});

	test("the prompt doesn't require shared interests when the role fit is strong", () => {
		const [system] = decisionMessages(ada, proposal);
		expect(system!.content).toContain("a strong role fit counts");
		expect(system!.content).not.toContain("accept only if");
	});

	test("the prompt says roles needed are for others to fill", () => {
		const [system] = decisionMessages(ada, proposal);
		expect(system!.content).toContain(
			"rolesNeeded lists roles you need others to fill",
		);
	});
});
