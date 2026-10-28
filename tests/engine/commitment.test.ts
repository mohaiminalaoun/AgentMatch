import { describe, expect, test } from "vitest";
import {
	contactOf,
	recordMessage,
	type AgentMessage,
} from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import {
	isOpen,
	projectOwner,
	runCommitment,
} from "../../src/engine/commitment.js";
import type { Config } from "../../src/engine/config.js";
import { buildBoard } from "../../src/engine/discovery.js";
import type { RunEvent } from "../../src/engine/events.js";
import type { Profile } from "../../src/engine/profile.js";
import { JOIN_PREFIX } from "../../src/engine/proposal.js";
import { createWorld, type World } from "../../src/engine/round.js";
import { person } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// A person named after their id, with a project idea unless `idea` is false, and teams of up to `maxTeamSize`.
function human(id: string, idea = true, maxTeamSize = 4): Profile {
	const base = person(
		id,
		[{ name: "frontend", level: "expert" }],
		["education"],
		0,
	);
	return {
		...base,
		name: `Name of ${id}`,
		projectIdeas: idea
			? [{ title: `${id}'s project`, description: "A project." }]
			: [],
		preferences: { ...base.preferences, maxTeamSize },
	};
}

// Records, in both agents' histories, a conversation about `owner`'s project in which both continued through
// level 2. A `joiner` with no idea asks to join; otherwise the owner pitches.
function ready(world: World, owner: string, joiner: string): void {
	const joins = world.agents[joiner]!.profile.projectIdeas.length === 0;
	const messages: AgentMessage[] = [
		joins
			? {
					id: `${joiner}-${owner}`,
					from: joiner,
					to: owner,
					pitch: `${JOIN_PREFIX}${owner}'s project`,
					rolesNeeded: ["design"],
				}
			: {
					id: `${owner}-${joiner}`,
					from: owner,
					to: joiner,
					pitch: `${owner}'s project`,
					rolesNeeded: ["design"],
				},
		...[owner, joiner].map((from): AgentMessage => ({
			kind: "interest",
			from,
			to: from === owner ? joiner : owner,
			level: 2,
			interest: "continue",
		})),
	];
	for (const message of messages) {
		for (const [self, other] of [
			[owner, joiner],
			[joiner, owner],
		] as const) {
			world.agents[self] = recordMessage(
				world.agents[self]!,
				other,
				message,
			);
		}
	}
}

// A client whose fake model answers offer prompts from `offers` (owner → ids) and commitment prompts from
// `commits` (agent → owner id or null), counting calls per agent.
function fakeClient(
	offers: Record<string, unknown[]> = {},
	commits: Record<string, unknown> = {},
) {
	const calls: string[] = [];
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string);
		const who = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
		const last: string = messages.at(-1).content;
		calls.push(who);
		const reply = last.startsWith("Ready to join:")
			? { rationale: "Best fits.", offer: offers[who] ?? [] }
			: { rationale: "Best team.", commit: commits[who] ?? null };
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
	return { client, calls };
}

// Runs commitment on `world`, recording events.
async function commit(
	world: World,
	client: ReturnType<typeof fakeClient>["client"],
) {
	const events: RunEvent[] = [];
	const result = await runCommitment(client, world, {
		onEvent: (e) => events.push(e),
	});
	return { ...result, events };
}

const messagesOf = (events: RunEvent[]) =>
	events.flatMap((e) =>
		e.type === "bus" && e.event.type === "sent" && "kind" in e.event.message
			? [
					`${e.event.message.from}→${e.event.message.to} ${e.event.message.kind === "answer" ? e.event.message.answer : e.event.message.kind}`,
				]
			: [],
	);

describe("projectOwner", () => {
	test("a proposal pitching your own idea makes you the owner", () => {
		const world = createWorld([human("a"), human("b")]);
		ready(world, "a", "b");
		expect(projectOwner(world, "a", "b")).toBe("a");
		expect(projectOwner(world, "b", "a")).toBe("a");
	});

	test("a request to join makes the recipient the owner", () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		expect(projectOwner(world, "j", "a")).toBe("a");
	});

	test("nobody owns a conversation that hasn't happened", () => {
		const world = createWorld([human("a"), human("b")]);
		expect(projectOwner(world, "a", "b")).toBeUndefined();
	});
});

describe("runCommitment", () => {
	test("a ready pair becomes a committed team, and the two swap names", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		const { client } = fakeClient({}, { j: "a" });
		const result = await commit(world, client);

		expect(result.world.teams).toEqual([
			{
				id: "team-a",
				members: ["a", "j"],
				project: { title: "a's project", description: "A project." },
				status: "committed",
			},
		]);
		expect(messagesOf(result.events)).toEqual([
			"a→j offer",
			"j→a commit",
			"a→j share",
			"j→a share",
		]);
		const { agents } = result.world;
		expect(contactOf(agents.a!, "j").learned.name).toBe("Name of j");
		expect(contactOf(agents.j!, "a").learned.name).toBe("Name of a");
		expect(contactOf(agents.a!, "j").level).toBe(3);
		expect(contactOf(agents.a!, "j").revealed).toContain("name");
		expect(result).toMatchObject({ offers: 1, commits: 1, skipped: false });
	});

	test("an owner with places for everyone ready offers to all without a model call", async () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("k", false),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		const { client, calls } = fakeClient({}, { j: "a", k: "a" });
		const { events } = await commit(world, client);
		expect(calls).not.toContain("a");
		expect(events.find((e) => e.type === "offers")).toMatchObject({
			agent: "a",
			to: ["j", "k"],
			places: 3,
			fellBack: false,
		});
	});

	test("with more people ready than places, the owner's model picks, and only that many get offers", async () => {
		const world = createWorld([
			human("a", true, 2),
			human("j", false),
			human("k", false),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		const { client } = fakeClient({ a: ["k", "j"] }, { k: "a" });
		const result = await commit(world, client);
		expect(
			messagesOf(result.events).filter((m) => m.endsWith("offer")),
		).toEqual(["a→k offer"]);
		expect(result.world.teams[0]!.members).toEqual(["a", "k"]);
	});

	test("someone holding two offers commits to one, at once, and declines the other", async () => {
		const world = createWorld([human("a"), human("b"), human("j", false)]);
		ready(world, "a", "j");
		ready(world, "b", "j");
		const { client } = fakeClient({}, { j: "b" });
		const result = await commit(world, client);
		expect(messagesOf(result.events)).toEqual(
			expect.arrayContaining(["j→a decline", "j→b commit"]),
		);
		expect(result.world.teams.map((t) => t.members)).toEqual([["b", "j"]]);
		expect(
			contactOf(result.world.agents.j!, "a").learned.name,
		).toBeUndefined();
	});

	test("an owner that sent offers is bound to its own project and declines others' without a model call", async () => {
		const world = createWorld([human("a"), human("b"), human("j", false)]);
		ready(world, "a", "b");
		ready(world, "b", "j");
		const { client, calls } = fakeClient({}, { j: "b" });
		const { events, world: after } = await commit(world, client);
		expect(calls).not.toContain("b");
		expect(
			events.find((e) => e.type === "commitment" && e.agent === "b"),
		).toMatchObject({
			chose: null,
		});
		expect(after.teams.map((t) => t.members)).toEqual([["b", "j"]]);
	});

	test("if no valid answer comes back, every offer is declined", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		const { client } = fakeClient({}, { j: "nobody-offered" });
		const result = await commit(world, client);
		expect(result.world.teams).toEqual([]);
		expect(
			result.events.find((e) => e.type === "commitment"),
		).toMatchObject({
			chose: null,
			fellBack: true,
		});
	});

	test("teammates who never talked learn each other's names, and nobody else learns any", async () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("k", false),
			human("x"),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		ready(world, "x", "j"); // x is turned down by j, so learns nothing
		const { client } = fakeClient({}, { j: "a", k: "a" });
		const { world: after } = await commit(world, client);
		expect(after.teams.map((t) => t.members)).toEqual([["a", "j", "k"]]);
		expect(contactOf(after.agents.j!, "k").learned.name).toBe("Name of k");
		expect(contactOf(after.agents.k!, "j").learned.name).toBe("Name of j");
		for (const agent of Object.values(after.agents)) {
			const team = after.teams.find((t) => t.members.includes(agent.id));
			for (const [other, contact] of Object.entries(agent.contacts)) {
				if (contact.learned.name !== undefined) {
					expect(team?.members).toContain(other);
				}
			}
		}
	});

	test("nobody is in two teams, and no team outgrows its owner's size", async () => {
		const world = createWorld([
			human("a", true, 2),
			human("b", true, 3),
			human("j", false),
			human("k", false),
			human("m", false),
		]);
		for (const joiner of ["j", "k", "m"]) {
			ready(world, "a", joiner);
			ready(world, "b", joiner);
		}
		const { client } = fakeClient(
			{ a: ["j"], b: ["j", "k"] },
			{ j: "a", k: "b", m: "a" },
		);
		const { world: after } = await commit(world, client);
		const members = after.teams.flatMap((t) => t.members);
		expect(new Set(members).size).toBe(members.length);
		for (const team of after.teams) {
			expect(team.members.length).toBeLessThanOrEqual(
				after.agents[team.members[0]!]!.profile.preferences.maxTeamSize,
			);
		}
	});

	test("an owner isn't offered to again by someone who declined it", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		const first = await commit(world, fakeClient({}, { j: null }).client);
		const second = await commit(
			first.world,
			fakeClient({}, { j: "a" }).client,
		);
		expect(second.offers).toBe(0);
		expect(second.world.teams).toEqual([]);
	});

	test("with mail still waiting from the round, nothing is offered", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		world.bus.send("a", {
			kind: "interest",
			from: "a",
			to: "j",
			level: 1,
			interest: "continue",
		});
		const result = await commit(world, fakeClient().client);
		expect(result).toMatchObject({ skipped: true, offers: 0 });
	});

	test("the world passed in is left unchanged", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		const before = structuredClone(world.agents);
		await commit(world, fakeClient({}, { j: "a" }).client);
		expect(world.agents).toEqual(before);
		expect(world.teams).toEqual([]);
	});
});

describe("after commitment", () => {
	test("members leave the board and stop looking; an owner with places stays", async () => {
		const world = createWorld([
			human("a"),
			human("b"),
			human("full", true, 2),
			human("j", false),
		]);
		ready(world, "a", "b");
		ready(world, "full", "j");
		const { world: after } = await commit(
			world,
			fakeClient({}, { b: "a", j: "full" }).client,
		);
		expect(isOpen(after, "a")).toBe(true);
		expect(isOpen(after, "b")).toBe(false);
		expect(isOpen(after, "full")).toBe(false);
		expect(buildBoard(after).map((e) => e.id)).toEqual(["a"]);
	});
});
