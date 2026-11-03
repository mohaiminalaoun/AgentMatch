import { describe, expect, test } from "vitest";
import { learn, raiseLevel } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import { RunEvent } from "../../src/engine/events.js";
import {
	repairProblems,
	repairVoteMessages,
	runRepair,
	type RepairProposal,
} from "../../src/engine/repair.js";
import { runLock } from "../../src/engine/lock.js";
import { createWorld, type World } from "../../src/engine/round.js";
import { person } from "../fixtures.js";

function group(): World {
	const profiles = [
		person("a", [{ name: "frontend", level: "expert" }], ["education"], 0),
		person("b", [{ name: "ml", level: "expert" }], ["falconry"], 0),
	];
	const world = createWorld(profiles);
	for (const id of ["a", "b"]) {
		const other = profiles.find((p) => p.id !== id)!;
		world.agents[id] = learn(
			raiseLevel(world.agents[id]!, other.id, 2),
			other.id,
			{
				skills: other.skills,
				interests: other.interests,
				availability: other.availability,
				preferences: other.preferences,
			},
		);
	}
	world.teams = [
		{
			id: "team-a",
			members: ["a", "b"],
			project: {
				title: "Tutor",
				description: "Practice lessons and save sessions.",
			},
			problem: "Students need practice.",
			build: "Classify exercises and save sessions to a server.",
			roleWork: {
				ml: "classify exercises",
				backend: "save sessions on a server",
			},
			rolesNeeded: ["ml", "backend"],
			status: "tentative",
		},
	];
	return world;
}
const proposal: RepairProposal = {
	rationale: "Remove the server dependency while retaining lesson practice.",
	revision: {
		title: "Local Tutor",
		pitch: "Practice lessons locally.",
		problem: "Students need practice.",
		build: "Classify bundled exercises with local session state.",
		rolesNeeded: ["ml"],
		roleWork: { ml: "classify exercises" },
	},
	removedWork: [
		{
			role: "backend",
			change: "Use bundled exercises and local state instead of server accounts and saved sessions.",
		},
	],
};

function fake(
	proposed: unknown = proposal,
	votes: Record<string, unknown> = {},
) {
	const calls: { who: string; content: string }[] = [];
	const client = createLlmClient(
		{
			baseUrl: "https://model.test/v1",
			apiKey: "test-only",
			model: "test",
			maxConcurrency: 8,
		},
		{
			fetch: (async (_url, init) => {
				const { messages } = JSON.parse(String(init?.body));
				const who = /"id": "([^"]+)"/.exec(messages[1].content)![1]!;
				const content = messages.at(-1).content;
				calls.push({ who, content });
				const reply = content.startsWith("Your group:")
					? {
							rationale: "Final independent confirmation",
							confident: true,
						}
					: content.startsWith("Repair this group:")
						? proposed
						: {
								rationale: `Private vote from ${who}`,
								approve: votes[who] ?? true,
							};
				return Response.json({
					choices: [{ message: { content: JSON.stringify(reply) } }],
				});
			}) as typeof fetch,
		},
	);
	return { client, calls };
}

describe("bounded scope repair", () => {
	test("applies only after unanimous approval, preserves roster, and records the scope change", async () => {
		const world = group();
		const before = structuredClone(world.teams);
		const { client, calls } = fake();
		const events: RunEvent[] = [];
		const result = await runRepair(client, world, {
			onEvent: (e) => events.push(e),
		});
		expect(result).toMatchObject({ proposed: 1, applied: 1 });
		expect(result.world.teams[0]).toMatchObject({
			project: { title: "Local Tutor" },
			rolesNeeded: ["ml"],
			roles: { b: "ml" },
			build: proposal.revision!.build,
			status: "tentative",
			members: ["a", "b"],
		});
		expect(world.teams).toEqual(before);
		expect(calls).toHaveLength(3);
		expect(
			events.filter((e) => e.type === "repair" && e.step === "vote"),
		).toHaveLength(2);
		expect(events.every((e) => RunEvent.safeParse(e).success)).toBe(true);
	});
	test("final confirmation sees the adopted build and can independently accept it", async () => {
		const { client, calls } = fake();
		const repaired = await runRepair(client, group());
		const locked = await runLock(client, repaired.world, {
			revealNames: false,
		});
		expect(locked.world.teams[0]).toMatchObject({
			status: "committed",
			project: { title: "Local Tutor" },
			build: proposal.revision!.build,
			rolesNeeded: ["ml"],
		});
		const finalPrompts = calls.filter((c) =>
			c.content.startsWith("Your group:"),
		);
		expect(finalPrompts).toHaveLength(2);
		expect(
			finalPrompts.every((c) =>
				c.content.includes(proposal.revision!.build),
			),
		).toBe(true);
		expect(
			finalPrompts.every((c) =>
				c.content.includes('"rolesStillNeeded":[]'),
			),
		).toBe(true);
	});

	test.each([false, "invalid"])(
		"one rejecting or failed vote (%s) leaves the original team unchanged",
		async (vote) => {
			const world = group();
			const { client } = fake(proposal, { b: vote });
			const result = await runRepair(client, world);
			expect(result.applied).toBe(0);
			expect(result.world.teams).toEqual(world.teams);
		},
	);
	test("an invalid proposal gets at most two attempts and no votes", async () => {
		const { client, calls } = fake({ rationale: "bad", revision: {} });
		const result = await runRepair(client, group());
		expect(result.applied).toBe(0);
		expect(calls).toHaveLength(2);
	});
	test("owner may keep the original; complete and committed teams make no repair calls", async () => {
		const { client, calls } = fake({ rationale: "No credible reduction." });
		expect((await runRepair(client, group())).proposed).toBe(0);
		expect(calls).toHaveLength(1);
		const world = group();
		world.teams[0]!.rolesNeeded = ["ml"];
		await runRepair(client, world);
		world.teams[0]!.rolesNeeded = ["backend"];
		world.teams[0]!.status = "committed";
		await runRepair(client, world);
		expect(calls).toHaveLength(1);
	});
	test("rejects unexplained role retirement, new work, and uncovered remaining work", () => {
		const world = group();
		const team = world.teams[0]!;
		expect(
			repairProblems(world, team, { ...proposal, removedWork: [] }),
		).not.toEqual([]);
		expect(
			repairProblems(world, team, {
				...proposal,
				revision: {
					...proposal.revision!,
					rolesNeeded: ["ml", "devops"],
					roleWork: { ml: "classify", devops: "deploy" },
				},
			}),
		).toContain("A repair may not add new required roles");
		expect(
			repairProblems(world, team, {
				...proposal,
				revision: {
					...proposal.revision!,
					rolesNeeded: ["ml", "backend"],
				},
				removedWork: [],
			}),
		).toContain("Required backend is still uncovered");
	});
	test("proposal cannot disclose private owner or third-party information to the team", () => {
		const world = group();
		const team = world.teams[0]!;
		expect(
			repairProblems(world, team, {
				...proposal,
				revision: {
					...proposal.revision!,
					pitch: "Built by a frontend expert.",
				},
			}),
		).toContain(
			"Proposal contains a non-public owner fact or invalid role",
		);
		expect(
			repairProblems(world, team, {
				...proposal,
				removedWork: [
					{
						role: "backend",
						change: "Use falconry exercises offline.",
					},
				],
			}),
		).toContain(
			"Proposal contains non-public information learned from another person",
		);
	});
	test("approval prompts never receive the owner's rationale or another member's private facts", () => {
		const world = group();
		const c = person(
			"c",
			[{ name: "data", level: "expert" }],
			["secret-orchids"],
			0,
		);
		const extra = createWorld([c]);
		world.agents.c = extra.agents.c!;
		world.teams[0]!.members.push("c");
		world.agents.a = learn(raiseLevel(world.agents.a!, "c", 2), "c", {
			interests: c.interests,
			skills: c.skills,
		});
		const text = JSON.stringify(
			repairVoteMessages(world.agents.b!, world.teams[0]!, {
				...proposal,
				rationale: "OWNER-PRIVATE-MARKER",
			}),
		);
		expect(text).not.toContain("OWNER-PRIVATE-MARKER");
		expect(text).not.toContain("secret-orchids");
	});
});
