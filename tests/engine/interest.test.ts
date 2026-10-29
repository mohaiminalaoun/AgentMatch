import { describe, expect, test } from "vitest";
import {
	createAgent,
	raiseLevel,
	recordMessage,
} from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import {
	checkInterest,
	considerRevision,
	interestMessages,
} from "../../src/engine/interest.js";
import { BRAINSTORM_PITCH } from "../../src/engine/proposal.js";
import { sampleProfile } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// Ada's agent at `level` with p9.
const at = (level: 1 | 2) =>
	raiseLevel(createAgent(sampleProfile), "p9", level);

// A client whose fake model gives each reply in turn (repeating the last), recording what it was sent.
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

describe("interestMessages", () => {
	test("at level 1, interests alone aren't a reason to withdraw, since skills come next", () => {
		const [system] = interestMessages(at(1), "p9");
		expect(system!.content).toContain(
			"don't withdraw over interests alone",
		);
		expect(system!.content).toContain("time zones");
	});

	test("at level 2, the check is about complementary skills", () => {
		const [system] = interestMessages(at(2), "p9");
		expect(system!.content).toContain("complement");
	});
});

describe("checkInterest", () => {
	test("returns the model's answer and private rationale", async () => {
		const result = await checkInterest(
			fakeModel({ rationale: "Hours overlap.", interest: "continue" }),
			at(1),
			"p9",
		);
		expect(result).toMatchObject({
			interest: "continue",
			rationale: "Hours overlap.",
			fellBack: false,
		});
	});

	test("withdraws if no valid answer comes back, since continuing would share more", async () => {
		const result = await checkInterest(
			fakeModel({ interest: "maybe" }),
			at(1),
			"p9",
		);
		expect(result).toMatchObject({ interest: "withdraw", fellBack: true });
	});
});

describe("revisions", () => {
	const revision = {
		pitch: "A carbon tracker for school clubs.",
		// Not "design": Ada (the sample profile) has that skill, so listing it would reveal it at level 1.
		rolesNeeded: ["mobile"],
	};
	const withRevision = (r: object) => ({
		rationale: "A better fit.",
		interest: "continue",
		revision: r,
	});

	test("a revision that passes the gate is returned with the continue", async () => {
		const result = await checkInterest(
			fakeModel(withRevision(revision)),
			at(1),
			"p9",
		);
		expect(result).toMatchObject({ interest: "continue", revision });
		expect(result.gateBlocks).toBe(0);
	});

	test("a revision naming the human's own skill at level 1 is sent back and redrafted", async () => {
		const client = fakeModel(
			withRevision({
				...revision,
				pitch: "A typescript carbon tracker.",
			}),
			withRevision(revision),
		);
		const result = await checkInterest(client, at(1), "p9");
		expect(result.revision).toEqual(revision);
		expect(result.gateBlocks).toBe(1);
		expect(client.sent[1]).toContain("typescript");
	});

	test("listing the human's own role as needed is blocked before level 2", async () => {
		const result = await checkInterest(
			fakeModel(
				withRevision({ ...revision, rolesNeeded: ["typescript"] }),
			),
			at(1),
			"p9",
		);
		expect(result).toMatchObject({ interest: "withdraw", fellBack: true });
		expect(result.gateBlocks).toBe(3);
	});

	test("a revision with a withdrawal is refused", async () => {
		const result = await checkInterest(
			fakeModel({ rationale: "No.", interest: "withdraw", revision }),
			at(1),
			"p9",
		);
		expect(result.fellBack).toBe(true);
	});

	test("after two revisions, no more are invited or allowed", async () => {
		let agent = at(1);
		for (const pitch of ["One.", "Two."]) {
			agent = recordMessage(agent, "p9", {
				kind: "revision",
				from: "p9",
				to: sampleProfile.id,
				level: 1,
				pitch,
				rolesNeeded: ["design"],
			});
		}
		const [system] = interestMessages(agent, "p9");
		expect(system!.content).not.toContain("add a revision");
		const result = await checkInterest(
			fakeModel(withRevision(revision)),
			agent,
			"p9",
		);
		expect(result.fellBack).toBe(true);
	});

	test("level 0 never invites a revision", () => {
		const [system] = interestMessages(createAgent(sampleProfile), "p9");
		expect(system!.content).not.toContain("add a revision");
	});

	test("considering a revision: adopt, or keep it if no valid answer comes back", async () => {
		const received = {
			kind: "revision" as const,
			from: "p9",
			to: sampleProfile.id,
			level: 1 as const,
			...revision,
		};
		expect(
			await considerRevision(
				fakeModel({ rationale: "Better.", adopt: true }),
				at(1),
				received,
			),
		).toMatchObject({ adopt: true, fellBack: false });
		expect(
			await considerRevision(
				fakeModel({ adopt: "maybe" }),
				at(1),
				received,
			),
		).toMatchObject({ adopt: false, fellBack: true });
	});
});

describe("level 2 and the roles a team needs", () => {
	// Ada at level 2 with p9, having accepted p9's proposal for a project needing mobile and backend.
	const agreedAt = (level: 1 | 2) =>
		recordMessage(
			recordMessage(at(level), "p9", {
				id: "p1",
				from: "p9",
				to: sampleProfile.id,
				pitch: "A carbon tracker.",
				rolesNeeded: ["mobile", "backend"],
			}),
			"p9",
			{
				decision: "accept",
				proposalId: "p1",
				from: sampleProfile.id,
				to: "p9",
			},
		);

	test("at level 2, the check says a team only forms if someone fills a needed role", () => {
		const [, user] = interestMessages(agreedAt(2), "p9", 2);
		expect(user!.content).toContain(
			"A team only forms if someone fills a role the version you've agreed on needs (mobile, backend",
		);
	});

	test("at level 1, skills aren't known yet, so it isn't said", () => {
		const [, user] = interestMessages(agreedAt(1), "p9", 1);
		expect(user!.content).not.toContain("A team only forms");
	});
});

describe("level 2 in a brainstorm", () => {
	// Ada at level 2 with p9: p9 proposed brainstorming, Ada accepted, and Ada adopted p9's idea at level 1,
	// plus `extra` revisions after it.
	const brainstormedAt2 = (extra = 0) => {
		const messages = [
			{
				id: "b1",
				from: "p9",
				to: sampleProfile.id,
				pitch: BRAINSTORM_PITCH,
				rolesNeeded: ["design"],
			},
			{
				decision: "accept" as const,
				proposalId: "b1",
				from: sampleProfile.id,
				to: "p9",
			},
			...Array.from({ length: 1 + extra }, () => ({
				kind: "revision" as const,
				from: "p9",
				to: sampleProfile.id,
				level: 1 as const,
				pitch: "A study planner.",
				rolesNeeded: ["mobile"],
			})),
			{
				kind: "revisionAnswer" as const,
				from: sampleProfile.id,
				to: "p9",
				adopt: true,
			},
		];
		return messages.reduce(
			(agent, m) => recordMessage(agent, "p9", m),
			at(2),
		);
	};

	test("asks to reshape the idea around both skill sets instead of withdrawing", () => {
		const [system, user] = interestMessages(brainstormedAt2(), "p9", 2);
		expect(system!.content).toContain("a fair fit beats no team");
		expect(system!.content).not.toContain("Be selective");
		expect(user!.content).toContain("the idea you agreed on needs mobile");
		expect(user!.content).toContain(
			"don't withdraw: continue with a revision",
		);
		expect(user!.content).not.toContain("Continue only if one of you does");
	});

	test("with no revisions left, falls back to the usual role check", () => {
		const [system, user] = interestMessages(brainstormedAt2(1), "p9", 2);
		expect(system!.content).toContain("Be selective");
		expect(user!.content).toContain("Continue only if one of you does");
	});
});
