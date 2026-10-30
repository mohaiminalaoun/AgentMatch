import { describe, expect, test } from "vitest";
import { CITE_FACTS, GOOD_TEAM } from "../../src/engine/goals.js";
import {
	createAgent,
	learn,
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
	test("every level judges by the shared standard, with the computed facts", () => {
		for (const level of [1, 2] as const) {
			const [system] = interestMessages(at(level), "p9");
			expect(system!.content).toContain(GOOD_TEAM);
			expect(system!.content).toContain(CITE_FACTS);
			expect(system!.content).toContain(
				"Facts about you and p9 (computed by code",
			);
		}
	});

	test("level 1 doesn't guess at skills, and level 2 weighs everything together", () => {
		const [one] = interestMessages(at(1), "p9");
		expect(one!.content).toContain("without guessing at skills");
		expect(one!.content).not.toContain("interests alone");
		const [two] = interestMessages(at(2), "p9");
		expect(two!.content).toContain("Weigh everything together");
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
	// plus `extra` revisions after it. p9 has shared expert backend and beginner design.
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
		return learn(
			messages.reduce((agent, m) => recordMessage(agent, "p9", m), at(2)),
			"p9",
			{
				skills: [
					{ name: "backend", level: "expert" },
					{ name: "design", level: "beginner" },
				],
			},
		);
	};

	test("allows reshaping the idea around what the other is strong in, but not forcing a fit", () => {
		const [system, user] = interestMessages(brainstormedAt2(), "p9", 2);
		expect(system!.content).toContain(
			"a team that doesn't really fit is worse than none",
		);
		expect(system!.content).not.toContain("Be selective");
		expect(user!.content).toContain("the idea you agreed on needs mobile");
		expect(user!.content).toContain(
			"it must need a role agent p9 is strong in (backend)",
		);
		expect(user!.content).not.toContain("Continue only if one of you does");
	});

	test("a reshaped idea that doesn't need anything the other is strong in is sent back", async () => {
		const client = fakeModel(
			{
				rationale: "Design-led.",
				interest: "continue",
				revision: { pitch: "A poster maker.", rolesNeeded: ["design"] },
			},
			{
				rationale: "Backend-led.",
				interest: "continue",
				revision: {
					pitch: "An API for posters.",
					rolesNeeded: ["backend"],
				},
			},
		);
		const result = await checkInterest(client, brainstormedAt2(), "p9", 2);
		expect(client.sent).toHaveLength(2);
		expect(client.sent[1]).toContain(
			"must need a role agent p9 is strong in",
		);
		expect(result.revision?.rolesNeeded).toEqual(["backend"]);
	});

	test("with no revisions left, falls back to the usual role check", () => {
		const [system, user] = interestMessages(brainstormedAt2(1), "p9", 2);
		expect(system!.content).not.toContain(
			"reshaping the idea to fit you both",
		);
		expect(user!.content).toContain(
			"don't relabel roles just so an offer becomes possible",
		);
	});
});
