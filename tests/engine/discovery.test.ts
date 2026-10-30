import { describe, expect, test } from "vitest";
import { raiseLevel, recordMessage } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import {
	brainstorm,
	brainstormBoard,
	buildBoard,
	buildSeekers,
	canBrainstorm,
	discover,
	discoveryMessages,
	leftovers,
} from "../../src/engine/discovery.js";
import { BRAINSTORM_PITCH } from "../../src/engine/proposal.js";
import type { RunEvent } from "../../src/engine/events.js";
import type { Profile } from "../../src/engine/profile.js";
import { createWorld } from "../../src/engine/round.js";
import { person } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// A person with one project idea, or none if `title` is undefined.
function withIdea(p: Profile, title?: string): Profile {
	return {
		...p,
		projectIdeas: title
			? [{ title, description: `${title}, as a hackathon project.` }]
			: [],
	};
}

const ben = withIdea(
	person("ben", [{ name: "backend", level: "expert" }], ["climate"], -5),
	"City emissions tracker",
);
const kemi = withIdea(
	person("kemi", [{ name: "frontend", level: "expert" }], ["education"], 1),
	"Accessible study tools",
);
const nia = withIdea(
	person("nia", [{ name: "ml", level: "expert" }], ["education"], 0),
	"AI note-taking app",
);
// No project idea: can browse and ask to join, but isn't on the board.
const omar = withIdea(
	person("omar", [{ name: "design", level: "expert" }], ["climate"], 5.5),
);

// A client whose fake model picks by who is asking, recording every prompt it was sent.
function fakeClient(picks: Record<string, string[]>) {
	const prompts: Record<string, string> = {};
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string);
		const agent = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
		prompts[agent] = JSON.stringify(messages);
		const content = JSON.stringify({
			rationale: `Private reasoning for ${agent}.`,
			approach: picks[agent] ?? [],
		});
		return new Response(
			JSON.stringify({ choices: [{ message: { content } }] }),
		);
	}) as typeof globalThis.fetch;
	const client = createLlmClient(config, {
		fetch,
		retry: { sleep: async () => {} },
	});
	return { client, prompts };
}

const world = () => createWorld([ben, kemi, nia, omar]);
const pairs = (proposals: { from: string; to: string }[]) =>
	proposals.map((p) => `${p.from}→${p.to}`);

describe("buildBoard", () => {
	test("lists only agents with a project idea, with only their level-0 pitch and roles", () => {
		const board = buildBoard(world());
		expect(board.map((e) => e.id)).toEqual(["ben", "kemi", "nia"]);
		expect(board[0]).toEqual({
			id: "ben",
			title: "City emissions tracker",
			pitch: "City emissions tracker: City emissions tracker, as a hackathon project.",
			rolesNeeded: ["frontend", "design", "product"],
		});
		expect(Object.keys(board[0]!).sort()).toEqual([
			"id",
			"pitch",
			"rolesNeeded",
			"title",
		]);
	});
});

describe("discover", () => {
	test("each agent's picks become proposals carrying its own public pitch", async () => {
		const { client } = fakeClient({ kemi: ["nia"], ben: ["kemi"] });
		const { proposals } = await discover(client, world());
		expect(pairs(proposals)).toEqual(["ben→kemi", "kemi→nia"]);
		expect(proposals.find((p) => p.from === "kemi")).toMatchObject({
			id: "r1-kemi-nia",
			pitch: "Accessible study tools: Accessible study tools, as a hackathon project.",
		});
	});

	test("an agent with no project idea asks to join the target's project", async () => {
		const { client } = fakeClient({ omar: ["ben"] });
		const { proposals } = await discover(client, world());
		expect(proposals).toEqual([
			{
				id: "r1-omar-ben",
				from: "omar",
				to: "ben",
				title: "City emissions tracker",
				pitch: "Join your project: City emissions tracker: City emissions tracker, as a hackathon project.",
				rolesNeeded: ["frontend", "design", "product"],
				join: true,
			},
		]);
	});

	test("two agents who pick each other get one proposal, from the first in id order", async () => {
		const { client } = fakeClient({ kemi: ["nia"], nia: ["kemi"] });
		const { proposals } = await discover(client, world());
		expect(pairs(proposals)).toEqual(["kemi→nia"]);
	});

	test("picks are trimmed to perAgent and duplicates dropped", async () => {
		const { client } = fakeClient({ omar: ["ben", "ben", "kemi", "nia"] });
		const { picks } = await discover(client, world(), { perAgent: 2 });
		expect(picks.find((p) => p.agent === "omar")!.approach).toEqual([
			"ben",
			"kemi",
		]);
	});

	test("an id that isn't on the board, or the agent itself, is retried, then dropped to nobody", async () => {
		const { client } = fakeClient({ kemi: ["kemi", "nobody"] });
		const { picks, proposals } = await discover(client, world());
		const kemiPick = picks.find((p) => p.agent === "kemi")!;
		expect(kemiPick).toMatchObject({ approach: [], fellBack: true });
		expect(proposals).toEqual([]);
	});

	test("agents already talking aren't approached again", async () => {
		const w = world();
		w.agents.kemi = recordMessage(w.agents.kemi!, "nia", {
			id: "earlier",
			from: "kemi",
			to: "nia",
			pitch: "Hello",
			rolesNeeded: ["ml"],
		});
		const { client } = fakeClient({ kemi: ["nia", "ben"] });
		const { proposals } = await discover(client, w);
		expect(pairs(proposals)).toEqual(["kemi→ben"]);
	});

	test("the round number goes into proposal ids", async () => {
		const { client } = fakeClient({ kemi: ["nia"] });
		const { proposals } = await discover(client, world(), { round: 2 });
		expect(proposals[0]!.id).toBe("r2-kemi-nia");
	});

	test("each agent's choice is emitted as a discovery event, with its private rationale", async () => {
		const { client } = fakeClient({ kemi: ["nia"] });
		const events: RunEvent[] = [];
		await discover(client, world(), { onEvent: (e) => events.push(e) });
		const discoveries = events.filter((e) => e.type === "discovery");
		expect(discoveries.map((e) => e.agent)).toEqual([
			"ben",
			"kemi",
			"nia",
			"omar",
		]);
		expect(discoveries[1]).toMatchObject({
			approach: ["nia"],
			rationale: "Private reasoning for kemi.",
		});
		expect(events.some((e) => e.type === "exchange")).toBe(true);
	});

	test("discovery prompts never contain another agent's private fields", async () => {
		const marked: Profile = {
			...kemi,
			skills: [{ name: "zz-secret-skill", level: "expert" }],
			interests: ["zz-secret-interest"],
			name: "ZzKemiName",
		};
		const { client, prompts } = fakeClient({});
		await discover(client, createWorld([ben, marked, nia, omar]));
		for (const agent of ["ben", "nia", "omar"]) {
			for (const secret of [
				"zz-secret-skill",
				"zz-secret-interest",
				"ZzKemiName",
			]) {
				expect(prompts[agent]).not.toContain(secret);
			}
			// Kemi's public pitch is on everyone else's board.
			expect(prompts[agent]).toContain("Accessible study tools");
		}
		expect(prompts.kemi).toContain("zz-secret-skill");
	});
});

describe("people looking to join", () => {
	test("are listed by id only, and only while they're open", () => {
		expect(buildSeekers(world())).toEqual([{ id: "omar" }]);
		const w = world();
		w.teams = [
			{
				id: "team-ben",
				members: ["ben", "omar"],
				project: ben.projectIdeas[0]!,
				rolesNeeded: ["design"],
				status: "committed",
			},
		];
		expect(buildSeekers(w)).toEqual([]);
	});

	test("are shown to agents with a project, not to other seekers", async () => {
		const { client, prompts } = fakeClient({});
		await discover(client, world());
		expect(prompts.kemi).toContain("Looking to join");
		expect(prompts.kemi).toContain('{\\"id\\":\\"omar\\"}');
		expect(prompts.omar).not.toContain("Looking to join");
	});

	test("an owner can approach one with its own pitch", async () => {
		const { client } = fakeClient({ kemi: ["omar"] });
		const { proposals } = await discover(client, world());
		expect(proposals).toEqual([
			{
				id: "r1-kemi-omar",
				from: "kemi",
				to: "omar",
				title: "Accessible study tools",
				pitch: "Accessible study tools: Accessible study tools, as a hackathon project.",
				rolesNeeded: ["backend", "design", "product"],
			},
		]);
	});

	test("someone with no project can't approach another seeker", async () => {
		const extra = withIdea(
			person("lea", [{ name: "data", level: "expert" }], ["music"], 0),
		);
		const { client } = fakeClient({ omar: ["lea"] });
		const { picks, proposals } = await discover(
			client,
			createWorld([ben, kemi, nia, omar, extra]),
		);
		expect(picks.find((p) => p.agent === "omar")).toMatchObject({
			approach: [],
			fellBack: true,
		});
		expect(proposals).toEqual([]);
	});

	test("nothing private about a seeker reaches anyone else's prompt", async () => {
		const marked: Profile = {
			...omar,
			skills: [{ name: "zz-secret-skill", level: "expert" }],
			interests: ["zz-secret-interest"],
			name: "ZzOmarName",
		};
		const { client, prompts } = fakeClient({});
		await discover(client, createWorld([ben, kemi, nia, marked]));
		for (const agent of ["ben", "kemi", "nia"]) {
			for (const secret of [
				"zz-secret-skill",
				"zz-secret-interest",
				"ZzOmarName",
			]) {
				expect(prompts[agent]).not.toContain(secret);
			}
		}
	});

	test("the prompt counts a strong role fit even when interests overlap loosely", () => {
		const [system] = discoveryMessages(
			createWorld([ben]).agents.ben!,
			[],
			3,
		);
		expect(system!.content).toContain("a strong role fit counts");
		expect(system!.content).not.toContain("Approach only");
	});
});

describe("brainstorm", () => {
	// A second person with no project idea, so two of them can find each other.
	const lea = withIdea(
		person("lea", [{ name: "backend", level: "expert" }], ["music"], 0),
	);
	const everyone = () => createWorld([ben, kemi, lea, nia, omar]);

	test("only people on no team are left over", () => {
		const w = everyone();
		w.teams = [
			{
				id: "team-ben",
				members: ["ben", "kemi"],
				project: ben.projectIdeas[0]!,
				rolesNeeded: ["design"],
				status: "committed",
			},
		];
		expect(leftovers(w)).toEqual(["lea", "nia", "omar"]);
	});

	test("a pair may brainstorm if it never got past level 0, and only once", () => {
		const w = everyone();
		expect(canBrainstorm(w.agents.omar!, "lea")).toBe(true);
		// A declined proposal stays at level 0: one retry is allowed.
		const declined = recordMessage(w.agents.omar!, "kemi", {
			decision: "decline",
			proposalId: "p1",
			from: "omar",
			to: "kemi",
			reason: "Not a fit right now.",
		});
		expect(canBrainstorm(declined, "kemi")).toBe(true);
		// A pair that reached level 1 can't start over.
		expect(canBrainstorm(raiseLevel(w.agents.omar!, "nia", 1), "nia")).toBe(
			false,
		);
		// After one brainstorm proposal, no second.
		const tried = recordMessage(w.agents.omar!, "lea", {
			id: "b1-omar-lea",
			from: "omar",
			to: "lea",
			pitch: BRAINSTORM_PITCH,
			rolesNeeded: ["frontend"],
		});
		expect(canBrainstorm(tried, "lea")).toBe(false);
	});

	test("the board shows each person's public idea, if any, and the core roles they lack, nothing more", () => {
		const board = brainstormBoard(everyone());
		expect(board.find((e) => e.id === "omar")).toEqual({
			id: "omar",
			rolesNeeded: ["frontend", "backend", "product"],
		});
		expect(board.find((e) => e.id === "ben")).toEqual({
			id: "ben",
			idea: "City emissions tracker: City emissions tracker, as a hackathon project.",
			rolesNeeded: ["frontend", "design", "product"],
		});
	});

	test("people with no idea can pick each other, and picks become brainstorm proposals built by code", async () => {
		const { client } = fakeClient({ omar: ["lea"] });
		const { proposals } = await brainstorm(client, everyone(), {
			round: 4,
		});
		expect(proposals).toEqual([
			{
				id: "b4-omar-lea",
				from: "omar",
				to: "lea",
				pitch: BRAINSTORM_PITCH,
				rolesNeeded: ["frontend", "backend", "product"],
			},
		]);
	});

	test("a pick that can't brainstorm is retried, then dropped", async () => {
		const w = everyone();
		w.agents.omar = raiseLevel(w.agents.omar!, "nia", 1);
		const { client } = fakeClient({ omar: ["nia"] });
		const { picks, proposals } = await brainstorm(client, w);
		expect(picks.find((p) => p.agent === "omar")).toMatchObject({
			approach: [],
			fellBack: true,
		});
		expect(proposals).toEqual([]);
	});

	test("brainstorm prompts never contain another person's private fields", async () => {
		const marked: Profile = {
			...lea,
			skills: [{ name: "zz-secret-skill", level: "expert" }],
			interests: ["zz-secret-interest"],
			name: "ZzLeaName",
		};
		const { client, prompts } = fakeClient({});
		await brainstorm(client, createWorld([ben, kemi, marked, nia, omar]));
		for (const agent of ["ben", "kemi", "nia", "omar"]) {
			for (const secret of [
				"zz-secret-skill",
				"zz-secret-interest",
				"ZzLeaName",
			]) {
				expect(prompts[agent]).not.toContain(secret);
			}
		}
	});
});
