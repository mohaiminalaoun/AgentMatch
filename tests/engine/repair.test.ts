import { describe, expect, test } from "vitest";
import { learn, raiseLevel } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import { RunEvent } from "../../src/engine/events.js";
import {
	RepairVote,
	repairProblems,
	repairMessages,
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
								cardConsistent: true,
								...(typeof votes[who] === "object"
									? (votes[who] as object)
									: {}),
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
	test("an inconsistent card cannot receive approval, but an honest smaller card can", () => {
		expect(
			RepairVote.safeParse({
				rationale: "Upload is removed but promised in pitch",
				cardConsistent: false,
				approve: true,
			}).success,
		).toBe(false);
		expect(
			RepairVote.safeParse({
				rationale: "Conflicting upload promises",
				cardConsistent: false,
				approve: false,
			}).success,
		).toBe(true);
		expect(
			RepairVote.safeParse({
				rationale: "Bundled images consistently described",
				cardConsistent: true,
				approve: true,
			}).success,
		).toBe(true);
	});

	test("a member finding a contradictory card prevents adoption and records the assessment", async () => {
		const world = group();
		const { client } = fake(proposal, {
			b: { approve: false, cardConsistent: false },
		});
		const events: RunEvent[] = [];
		const result = await runRepair(client, world, {
			onEvent: (e) => events.push(e),
		});
		expect(result.applied).toBe(0);
		expect(result.world.teams).toEqual(world.teams);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "repair",
				agent: "b",
				step: "vote",
				approve: false,
				cardConsistent: false,
				fellBack: false,
			}),
		);
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
	test("repeated ML terminology and unchanged health/research project text can survive a scope reduction", () => {
		const world = group();
		const team = world.teams[0]!;
		world.agents.a!.profile.skills.push({
			name: "ml",
			level: "intermediate",
		});
		world.agents.a!.profile.interests.push("health", "research");
		team.project.description =
			"Satellite flood alerts and an ML-tagged photo log with export.";
		team.problem = "Health science needs research practice.";
		team.build =
			"Regional flood signal plus alert demo and ML-tagged photo log with export.";
		const candidate = {
			...proposal,
			revision: {
				...proposal.revision!,
				pitch: "Satellite flood alerts and an ML-tagged photo log with export, shown without map UI.",
				problem: team.problem,
				build: "Regional flood signal plus alert demo and ML-tagged photo log with export via script.",
			},
		};
		expect(repairProblems(world, team, candidate)).toEqual([]);
		expect(
			repairProblems(world, team, {
				...candidate,
				revision: {
					...candidate.revision,
					pitch: "I have ML expertise and health research experience.",
				},
			}),
		).not.toEqual([]);
		expect(
			repairProblems(world, team, {
				...candidate,
				revision: {
					...candidate.revision,
					pitch: "The other member has ML expertise.",
				},
			}),
		).toContain(
			"Repairs must describe project work, not people or personal claims",
		);
	});
	test.each([
		"Physio patients forget their home exercises between appointments.",
		"Computer-use agents claim success on tasks they did not complete.",
	])("unchanged project pronouns do not block repairs: %s", (problem) => {
		const world = group();
		const team = world.teams[0]!;
		team.problem = problem;
		expect(
			repairProblems(world, team, {
				...proposal,
				revision: { ...proposal.revision!, problem },
			}),
		).toEqual([]);
		// Shared passages cannot authorize newly attached personal assertions.
		expect(
			repairProblems(world, team, {
				...proposal,
				revision: {
					...proposal.revision!,
					problem,
					pitch: "My human can classify exercises.",
				},
			}),
		).toContain(
			"Repairs must describe project work, not people or personal claims",
		);
	});

	test("repair consent uses final personal-fit criteria with recruitment closed", () => {
		const world = group();
		const prompt = repairVoteMessages(
			world.agents.b!,
			world.teams[0]!,
			proposal,
		)[0]!.content;
		expect(prompt).toContain("Recruitment has ended.");
		expect(prompt).toContain(
			"standing instructions and project interest now",
		);
		expect(prompt).toContain(
			"Do not approve a technically feasible repair",
		);
		expect(prompt).toContain(
			"Every role still listed in rolesNeeded remains required work",
		);
	});

	test("an owner's original listing is not assumed to be the current team's shared project context", () => {
		const world = group();
		const owner = world.agents.a!;
		const team = world.teams[0]!;
		owner.profile.skills.push({ name: "ml", level: "intermediate" });
		owner.listing = {
			title: "Original",
			pitch: "ML security expertise for scanning networks.",
			rolesNeeded: ["ml"],
		};
		expect(
			repairProblems(world, team, {
				...proposal,
				revision: {
					...proposal.revision!,
					pitch: "ML security expertise for scanning networks.",
				},
			}),
		).toContain(
			"Proposal contains a non-public owner fact or invalid role",
		);
	});
	test("owner work is explicit even when no owner role appears in teammate requirements", () => {
		const world = group();
		const team = world.teams[0]!;
		const owner = repairVoteMessages(world.agents.a!, team, proposal);
		const member = repairVoteMessages(world.agents.b!, team, proposal);
		expect(owner[0]!.content).toContain(
			"The owner's work is intentionally omitted",
		);
		expect(owner.at(-1)!.content).toContain(
			'"projectOwnerIsYourHuman":true',
		);
		expect(member.at(-1)!.content).toContain(
			'"projectOwnerIsYourHuman":false',
		);
		expect(
			repairMessages(world.agents.a!, team, ["backend"])[0]!.content,
		).toContain("not a complete list of all project work");
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
