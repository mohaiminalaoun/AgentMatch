import { describe, expect, test } from "vitest";
import {
	agreedTerms,
	agreedVersion,
	contactOf,
	learn,
	raiseLevel,
	recordMessage,
	type AgentMessage,
} from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import {
	candidatesOf,
	explainCandidates,
	isOpen,
	placesLeft,
	projectOwner,
	offerMessages,
	runCommitment,
	safeToOffer,
	teamOf,
	commitmentMessages,
	explainOffers,
	selectOffers,
	stillNeeded,
} from "../../src/engine/commitment.js";
import type { Config } from "../../src/engine/config.js";
import { formatEvent } from "../../src/describe.js";
import { decisionMessages } from "../../src/engine/decision.js";
import { buildBoard, discover } from "../../src/engine/discovery.js";
import type { RunEvent } from "../../src/engine/events.js";
import type { Profile } from "../../src/engine/profile.js";
import {
	BRAINSTORM_PITCH,
	JOIN_PREFIX,
	type Offer,
} from "../../src/engine/proposal.js";
import { GOOD_TEAM } from "../../src/engine/goals.js";
import { createWorld, type World } from "../../src/engine/round.js";
import { person } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// A person named after their id, with a project idea unless `idea` is false, teams of up to `maxTeamSize`,
// and one skill.
function human(
	id: string,
	idea = true,
	maxTeamSize = 4,
	skill = "frontend",
): Profile {
	const base = person(
		id,
		[{ name: skill, level: "expert" }],
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
// level 2, and what each learned from the other's level-2 share (skills and preferences). A `joiner` with no
// idea asks to join; otherwise the owner pitches. The owner's listing asks for the joiner's skill.
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
	for (const [self, other] of [
		[owner, joiner],
		[joiner, owner],
	] as const) {
		const { skills, preferences } = world.agents[other]!.profile;
		world.agents[self] = learn(world.agents[self]!, other, {
			skills,
			preferences,
		});
	}
	const ownerAgent = world.agents[owner]!;
	const roles = world.agents[joiner]!.profile.skills.map((s) => s.name);
	world.agents[owner] = {
		...ownerAgent,
		listing: {
			pitch: `${owner}'s project`,
			rolesNeeded: [
				...new Set([
					...(ownerAgent.listing?.rolesNeeded ?? []),
					...roles,
				]),
			],
		},
	};
}

// A client whose fake model answers offer prompts from `offers` (owner → ids), commitment prompts from
// `commits` (agent → owner id or null, or a list of those, one per call), and re-checks from `stays` (agent → stay or leave), counting calls
// per agent and keeping each prompt.
function fakeClient(
	offers: Record<string, unknown[]> = {},
	commits: Record<string, unknown> = {},
	stays: Record<string, unknown> = {},
	teamVersions: Record<string, unknown> = {},
) {
	const prompts: Record<string, string> = {};
	const calls: string[] = [];
	const fetch = (async (_url: unknown, init?: RequestInit) => {
		const { messages } = JSON.parse(init!.body as string);
		const who = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
		const last: string = messages.at(-1).content;
		calls.push(who);
		prompts[who] = JSON.stringify(messages);
		const reply = last.startsWith("Ready to join:")
			? { rationale: "Best fits.", offer: offers[who] ?? [] }
			: last.startsWith("Versions agreed with each:")
				? {
						rationale: "One for all.",
						...(teamVersions[who] as object),
					}
				: last.startsWith("Your teammates")
					? {
							rationale: "Weighed it.",
							decision: stays[who] ?? "stay",
						}
					: {
							rationale: "Best team.",
							commit:
								(Array.isArray(commits[who])
									? commits[who].shift()
									: commits[who]) ?? null,
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
	return { client, calls, prompts };
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
				// The version they agreed on: here, a's listing.
				project: { title: "a's project", description: "a's project" },
				rolesNeeded: ["frontend"],
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

	test("with names held back for approval, the team forms but nobody swaps names", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		const events: RunEvent[] = [];
		const result = await runCommitment(
			fakeClient({}, { j: "a" }).client,
			world,
			{ revealNames: false, onEvent: (e) => events.push(e) },
		);
		expect(result.world.teams.map((t) => t.members)).toEqual([["a", "j"]]);
		expect(messagesOf(events)).toEqual(["a→j offer", "j→a commit"]);
		expect(contactOf(result.world.agents.a!, "j").level).toBeLessThan(3);
		expect(contactOf(result.world.agents.a!, "j").revealed).not.toContain(
			"name",
		);
		expect(
			contactOf(result.world.agents.j!, "a").learned.name,
		).toBeUndefined();
	});

	test("an owner with places for everyone ready offers to all without a model call", async () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("k", false, 4, "design"),
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
			human("k", false, 4, "design"),
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

	test("an owner offered a place that chooses to lead answers busy, not decline, and sends its own offers", async () => {
		const world = createWorld([human("a"), human("b"), human("j", false)]);
		ready(world, "a", "b");
		ready(world, "b", "j");
		const { client, calls, prompts } = fakeClient({}, { j: "b", b: null });
		const { events, world: after } = await commit(world, client);
		expect(calls).toContain("b");
		expect(prompts.b).toContain("Your human also owns a project");
		expect(prompts.b).toContain("Your human's own team, if they lead");
		expect(
			events.find((e) => e.type === "commitment" && e.agent === "b"),
		).toMatchObject({
			chose: null,
			busy: true,
			rationale: "Best team.",
		});
		expect(messagesOf(events)).toContain("b→a busy");
		expect(messagesOf(events)).not.toContain("b→a decline");
		expect(after.teams.map((t) => t.members)).toEqual([["b", "j"]]);
	});

	test("an owner offered a place can join instead: its own offers are never sent", async () => {
		const world = createWorld([human("a"), human("b"), human("j", false)]);
		ready(world, "a", "b");
		ready(world, "b", "j");
		const { client } = fakeClient({}, { b: "a" });
		const { events, world: after } = await commit(world, client);
		expect(messagesOf(events)).not.toContain("b→j offer");
		expect(messagesOf(events)).toContain("b→a commit");
		expect(events.some((e) => e.type === "offers" && e.agent === "b")).toBe(
			false,
		);
		expect(after.teams.map((t) => t.members)).toEqual([["a", "b"]]);
	});

	test("a join only holds if the owner joined leads; otherwise the joiner is busy", async () => {
		// a offers b, b offers c, c offers a. b joins a, but a joins c, who leads: only c and a team up.
		const world = createWorld([human("a"), human("b"), human("c")]);
		ready(world, "a", "b");
		ready(world, "b", "c");
		ready(world, "c", "a");
		const { client } = fakeClient({}, { b: ["a"], a: ["c"], c: [null] });
		const { events, world: after } = await commit(world, client);
		expect(messagesOf(events)).not.toContain("a→b offer");
		expect(messagesOf(events)).toContain("a→c commit");
		expect(after.teams.map((t) => t.members)).toEqual([["c", "a"]]);
		expect(
			events.find((e) => e.type === "commitment" && e.agent === "b"),
		).toMatchObject({ chose: null, busy: true });
		expect(messagesOf(events).filter((m) => m.startsWith("b→"))).toEqual(
			[],
		);
	});

	test("someone busy in one pass can commit in the next, once its own offers are settled", async () => {
		// z wants x; x wants m; y wants m too. m picks y, so x's own offer fails, and x is free for z.
		const world = createWorld([
			human("m", false),
			human("x"),
			human("y"),
			human("z"),
		]);
		ready(world, "z", "x");
		ready(world, "x", "m");
		ready(world, "y", "m");
		// x leads at first, then, its own offer settled, commits to z.
		const { client } = fakeClient({}, { m: "y", x: [null, "z"] });
		const result = await commit(world, client);
		expect(result.world.teams.map((t) => t.members)).toEqual([
			["y", "m"],
			["z", "x"],
		]);
		const fromX = messagesOf(result.events).filter(
			(m) => m.startsWith("x→z") && !m.endsWith("share"),
		);
		expect(fromX).toEqual(["x→z busy", "x→z commit"]);
		expect(result.passes).toBe(3);
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
			human("k", false, 4, "design"),
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
			human("k", false, 4, "design"),
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
	test("members leave the board and stop looking; an owner with places and roles still needed stays", async () => {
		const world = createWorld([
			human("a"),
			human("b"),
			human("full", true, 2),
			human("j", false),
		]);
		ready(world, "a", "b");
		ready(world, "full", "j");
		// a also needs design, which b doesn't fill.
		world.agents.a = {
			...world.agents.a!,
			listing: {
				pitch: "a's project",
				rolesNeeded: ["frontend", "design"],
			},
		};
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

describe("team size and skills", () => {
	test("an owner whose needed roles are all filled goes off the board, places or not", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		const { world: after } = await commit(
			world,
			fakeClient({}, { j: "a" }).client,
		);
		expect(placesLeft(after, "a")).toBe(2);
		expect(stillNeeded(after, "a")).toEqual([]);
		expect(isOpen(after, "a")).toBe(false);
	});

	test("only people who fill a role the team still needs are offered a place", async () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("x", false, 4, "ml"),
		]);
		ready(world, "a", "j");
		ready(world, "a", "x");
		// a's listing asks only for frontend.
		world.agents.a = {
			...world.agents.a!,
			listing: { pitch: "a's project", rolesNeeded: ["frontend"] },
		};
		expect(candidatesOf(world, "a")).toEqual(["j"]);
		expect(explainCandidates(world, "a").excluded).toEqual([
			{
				id: "x",
				reason: "fills none of the roles still needed (frontend)",
			},
		]);
	});

	test("someone whose agreed version is their own isn't the owner's candidate, and the reason says so", () => {
		const world = createWorld([human("a"), human("j")]);
		ready(world, "a", "j");
		// a proposed its own project to j, so a owns it: j can't offer a a place on it.
		expect(explainCandidates(world, "j")).toEqual({
			candidates: [],
			excluded: [
				{
					id: "a",
					reason: "the version agreed with them is theirs, so they would own the team",
				},
			],
		});
	});

	test("the offers event lists everyone reached at level 2 who wasn't considered, and why", async () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("x", false, 4, "ml"),
		]);
		ready(world, "a", "j");
		ready(world, "a", "x");
		world.agents.a = {
			...world.agents.a!,
			listing: { pitch: "a's project", rolesNeeded: ["frontend"] },
		};
		const { events } = await commit(
			world,
			fakeClient({}, { j: "a" }).client,
		);
		const offers = events.find((e) => e.type === "offers");
		expect(offers).toMatchObject({
			agent: "a",
			to: ["j"],
			excluded: [
				{
					id: "x",
					reason: "fills none of the roles still needed (frontend)",
				},
			],
		});
		expect(formatEvent(offers!, { rationale: false })).toContain(
			"not considered x: fills none of the roles still needed (frontend)",
		);
	});

	test("two people who fill only the same role don't both get offers", () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("k", false),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		expect(candidatesOf(world, "a")).toEqual(["j", "k"]);
		expect(selectOffers(world, "a", ["k", "j"])).toEqual(["k"]);
		// a team of a and k already suits everyone's smallest size, so no second frontend.
		expect(
			explainOffers(world, "a", ["k", "j"], { extraBelowMinimum: true }),
		).toEqual({
			kept: ["k"],
			dropped: [
				{
					id: "j",
					reason: "every needed role they could fill is already taken: frontend by k",
				},
			],
		});
	});

	// j wants a team of at least 3; j and k can both only do frontend.
	function belowMinimumCase() {
		const j = human("j", false);
		const world = createWorld([
			human("a"),
			{ ...j, preferences: { ...j.preferences, minTeamSize: 3 } },
			human("k", false),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		return world;
	}

	test("while the team would be smaller than someone's smallest size, a second person for a taken role is kept, but only when the owner's model chose them", () => {
		const world = belowMinimumCase();
		expect(selectOffers(world, "a", ["k", "j"])).toEqual(["k"]);
		expect(
			explainOffers(world, "a", ["k", "j"], { extraBelowMinimum: true })
				.kept,
		).toEqual(["k", "j"]);
	});

	test("no team version is written when the only people cut are cut over roles, which one version can't change", async () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("k", false),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		const { events } = await commit(
			world,
			fakeClient({ a: ["k", "j"] }, { k: "a" }).client,
		);
		const prompts = events.flatMap((e) =>
			e.type === "exchange" ? [JSON.stringify(e.messages)] : [],
		);
		expect(prompts.some((p) => p.includes("Write one version"))).toBe(
			false,
		);
	});

	test("an owner whose model chooses two people for the same role offers both while the team is below someone's smallest size", async () => {
		const { events } = await commit(
			belowMinimumCase(),
			fakeClient({ a: ["k", "j"] }, { j: "a", k: "a" }).client,
		);
		expect(events.find((e) => e.type === "offers")).toMatchObject({
			to: ["k", "j"],
			ranked: ["k", "j"],
		});
	});

	// The pilot's dropped frontend expert, as a regression case: x can do ml and some frontend, j is a frontend
	// expert, and the project needs both.
	function frontendCase() {
		const world = createWorld([
			human("a"),
			{
				...human("x", false, 4, "ml"),
				skills: [
					{ name: "ml", level: "intermediate" },
					{ name: "frontend", level: "beginner" },
				],
			},
			human("j", false, 4, "frontend"),
		]);
		ready(world, "a", "x");
		ready(world, "a", "j");
		world.agents.a = {
			...world.agents.a!,
			listing: { pitch: "a's project", rolesNeeded: ["ml", "frontend"] },
		};
		return world;
	}

	test("someone chosen for one role doesn't use up every other role they could fill: each person takes a different one", () => {
		const world = frontendCase();
		expect(candidatesOf(world, "a").sort()).toEqual(["j", "x"]);
		// x takes ml, so j, the frontend expert, takes frontend.
		expect(explainOffers(world, "a", ["x", "j"])).toEqual({
			kept: ["x", "j"],
			dropped: [],
		});
	});

	test("someone already kept moves to another of their roles to make room", () => {
		// j can only do frontend; x, kept first, can do ml or frontend, so x takes ml.
		const world = frontendCase();
		expect(selectOffers(world, "a", ["x", "j"])).toEqual(["x", "j"]);
		expect(selectOffers(world, "a", ["j", "x"])).toEqual(["j", "x"]);
	});

	test("the offers event shows the model's choice and every drop the code made", async () => {
		const world = frontendCase();
		// a wants a team of at most 2, so only one of x and j can join, and a's model is asked to choose.
		const a = world.agents.a!;
		world.agents.a = {
			...a,
			profile: {
				...a.profile,
				preferences: { ...a.profile.preferences, maxTeamSize: 2 },
			},
		};
		const { events } = await commit(
			world,
			fakeClient({ a: ["x", "j"] }).client,
		);
		const offers = events.find((e) => e.type === "offers");
		expect(offers).toMatchObject({
			type: "offers",
			agent: "a",
			to: ["x"],
			ranked: ["x", "j"],
			dropped: [
				{
					id: "j",
					reason: "the team would pass its size limit of 2",
				},
			],
		});
		expect(formatEvent(offers!, { rationale: false })).toContain(
			"its model chose x, j · dropped j: the team would pass its size limit of 2",
		);
	});

	test("an owner choosing whom to offer sees the version agreed with each person, not its original idea", async () => {
		const world = frontendCase();
		const a = world.agents.a!;
		world.agents.a = {
			...a,
			profile: {
				...a.profile,
				preferences: { ...a.profile.preferences, maxTeamSize: 2 },
			},
		};
		// x and a agreed on a reshaped version.
		for (const [self, other] of [
			["a", "x"],
			["x", "a"],
		] as const) {
			world.agents[self] = recordMessage(world.agents[self]!, other, {
				kind: "revision",
				from: "x",
				to: "a",
				level: 2,
				title: "Reshaped",
				pitch: "The reshaped project.",
				rolesNeeded: ["ml"],
			});
			world.agents[self] = recordMessage(world.agents[self]!, other, {
				kind: "revisionAnswer",
				from: "a",
				to: "x",
				adopt: true,
			});
		}
		const { client, prompts } = fakeClient({ a: ["x"] });
		await commit(world, client);
		const [system, user] = (
			JSON.parse(prompts.a!) as { content: string }[]
		).slice(1);
		expect(system!.content).toContain("Your human has no team yet");
		expect(system!.content).not.toContain('"description":"A project."');
		expect(user!.content).toContain('"id":"x","shared":');
		expect(user!.content).toContain(
			'"version":{"title":"Reshaped","pitch":"The reshaped project.","rolesNeeded":["ml"]}',
		);
	});

	test("once a team exists, the owner sees the version the team is building", () => {
		const [system] = offerMessages(
			createWorld([human("a")]).agents.a!,
			["j"],
			1,
			{},
			["design"],
			{
				team: {
					title: "Team",
					pitch: "What the team builds.",
					rolesNeeded: ["design"],
				},
			},
		);
		expect(system!.content).toContain(
			'Your human\'s team is building this version of the project: {"title":"Team","pitch":"What the team builds."',
		);
	});

	test("a drop for size names whose limit it is", () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("small", false, 2, "design"),
		]);
		ready(world, "a", "j");
		ready(world, "a", "small");
		expect(explainOffers(world, "a", ["j", "small"]).dropped).toEqual([
			{
				id: "small",
				reason: "they want a team of at most 2, and it would be 3",
			},
		]);
		expect(explainOffers(world, "a", ["small", "j"]).dropped).toEqual([
			{ id: "j", reason: "the team would pass its size limit of 2" },
		]);
	});

	test("places are capped by the smallest maximum among the team, as learned", async () => {
		const world = createWorld([human("a", true, 5), human("j", false, 2)]);
		ready(world, "a", "j");
		expect(placesLeft(world, "a")).toBe(4);
		const { world: after } = await commit(
			world,
			fakeClient({}, { j: "a" }).client,
		);
		// j wants at most 2, and the team is 2 now.
		expect(placesLeft(after, "a")).toBe(0);
	});

	test("someone who wants a smaller team than this would become isn't offered a place", () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("small", false, 2, "design"),
		]);
		ready(world, "a", "j");
		ready(world, "a", "small");
		// Taking j first makes the team 2; small wants at most 2, so 3 would be too big.
		expect(selectOffers(world, "a", ["j", "small"])).toEqual(["j"]);
		// Taking small first caps the team at 2, so j no longer fits.
		expect(selectOffers(world, "a", ["small", "j"])).toEqual(["small"]);
	});
});

describe("the agreed project", () => {
	// Records, in both histories, `from` countering with `pitch` and the other side accepting it.
	function counterAccepted(
		world: World,
		from: string,
		to: string,
		pitch: string,
		rolesNeeded: string[],
		title?: string,
	) {
		const messages: AgentMessage[] = [
			{
				decision: "counter",
				proposalId: `${to}-${from}`,
				from,
				to,
				...(title !== undefined && { title }),
				pitch,
				rolesNeeded,
			},
			{
				decision: "accept",
				proposalId: `${to}-${from}.c`,
				from: to,
				to: from,
			},
		];
		for (const message of messages) {
			world.agents[from] = recordMessage(
				world.agents[from]!,
				to,
				message,
			);
			world.agents[to] = recordMessage(world.agents[to]!, from, message);
		}
	}

	test("agreedTerms is the last proposal or counter that was accepted", () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		// The join request was never accepted in this history, so nothing is agreed yet.
		expect(agreedTerms(world.agents.a!, "j")).toBeUndefined();
		counterAccepted(world, "a", "j", "A tutor for injury recovery.", [
			"frontend",
		]);
		expect(agreedTerms(world.agents.j!, "a")).toEqual({
			pitch: "A tutor for injury recovery.",
			rolesNeeded: ["frontend"],
		});
	});

	test("when revisions cross, each answer settles the revision it replies to", () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		counterAccepted(world, "a", "j", "A tutor for injury recovery.", [
			"frontend",
		]);
		const revision = (from: string, to: string, roles: string[]) =>
			({
				kind: "revision",
				from,
				to,
				level: 2,
				pitch: `${from}'s reshaped tutor.`,
				rolesNeeded: roles,
			}) as const;
		// Both reshape at once; j adopts a's version, and a keeps the current one over j's.
		const messages: AgentMessage[] = [
			revision("a", "j", ["backend"]),
			revision("j", "a", ["product"]),
			{ kind: "revisionAnswer", from: "j", to: "a", adopt: true },
			{ kind: "revisionAnswer", from: "a", to: "j", adopt: false },
		];
		for (const message of messages) {
			world.agents.a = recordMessage(world.agents.a!, "j", message);
			world.agents.j = recordMessage(world.agents.j!, "a", message);
		}
		const adopted = {
			pitch: "a's reshaped tutor.",
			rolesNeeded: ["backend"],
		};
		expect(agreedVersion(world.agents.a!, "j")).toEqual({
			terms: adopted,
			author: "a",
		});
		expect(agreedVersion(world.agents.j!, "a")).toEqual({
			terms: adopted,
			author: "a",
		});
	});

	test("an accepted join request agrees to the recipient's pitch, without the prefix", () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		const accept: AgentMessage = {
			decision: "accept",
			proposalId: "j-a",
			from: "a",
			to: "j",
		};
		world.agents.a = recordMessage(world.agents.a!, "j", accept);
		expect(agreedTerms(world.agents.a!, "j")).toEqual({
			pitch: "a's project",
			rolesNeeded: ["design"],
		});
	});

	test("the team builds the reshaped version, with its roles and no longer the idea's title, and the commit prompt showed it", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		counterAccepted(world, "a", "j", "A tutor for injury recovery.", [
			"frontend",
		]);
		const { client, prompts } = fakeClient({}, { j: "a" });
		const { world: after, events } = await commit(world, client);
		expect(after.teams[0]).toMatchObject({
			project: {
				title: "New project",
				description: "A tutor for injury recovery.",
			},
			rolesNeeded: ["frontend"],
		});
		expect(prompts.j).toContain("A tutor for injury recovery.");
		const offer = events.find(
			(e) =>
				e.type === "bus" &&
				e.event.type === "sent" &&
				"kind" in e.event.message &&
				e.event.message.kind === "offer",
		);
		expect(offer).toMatchObject({
			event: { message: { pitch: "A tutor for injury recovery." } },
		});
		// The public board still shows the original listing.
		expect(after.agents.a!.listing!.pitch).toBe("a's project");
	});

	test("the team takes the title agreed with its version, and the offer carried it", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		counterAccepted(
			world,
			"a",
			"j",
			"A tutor for injury recovery.",
			["frontend"],
			"RehabTutor",
		);
		const { client } = fakeClient({}, { j: "a" });
		const { world: after, events } = await commit(world, client);
		expect(after.teams[0]!.project).toEqual({
			title: "RehabTutor",
			description: "A tutor for injury recovery.",
		});
		const offer = events.find(
			(e) =>
				e.type === "bus" &&
				e.event.type === "sent" &&
				"kind" in e.event.message &&
				e.event.message.kind === "offer",
		);
		expect(offer).toMatchObject({
			event: { message: { title: "RehabTutor" } },
		});
	});

	test("every offer in a pass carries one version: the one agreed with the first person kept", () => {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("k", false, 4, "design"),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		counterAccepted(world, "a", "k", "A design-led tutor.", ["design"]);
		// k first: the team would build k's version, which j (frontend) doesn't fill.
		expect(selectOffers(world, "a", ["k", "j"])).toEqual(["k"]);
	});

	test("a version that reveals what was learned about someone else isn't offered to anyone new", () => {
		const world = createWorld([
			human("a"),
			human("j", false, 4, "zzphysio"),
			human("k", false),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		const version = {
			pitch: "A tutor for zzphysio clinics.",
			rolesNeeded: ["frontend"],
		};
		// Safe for j, whose own skill it is; not for k, who never learned it.
		expect(safeToOffer(world, "a", "j", version)).toBe(true);
		expect(safeToOffer(world, "a", "k", version)).toBe(false);
		counterAccepted(world, "a", "j", version.pitch, [
			"zzphysio",
			"frontend",
		]);
		expect(selectOffers(world, "a", ["j", "k"])).toEqual(["j"]);
	});

	// a agreed an ML version with j, which can't go to k, who never learned j's skill; a's model wants both.
	function twoVersionsCase() {
		const world = createWorld([
			human("a"),
			human("j", false, 4, "ml"),
			human("k", false),
		]);
		ready(world, "a", "j");
		ready(world, "a", "k");
		counterAccepted(world, "a", "j", "An ML tutor for clinics.", [
			"ml",
			"frontend",
		]);
		return world;
	}

	test("when the versions agreed with each would keep someone out, the owner writes one version for all, and every offer carries it", async () => {
		const world = twoVersionsCase();
		expect(selectOffers(world, "a", ["j", "k"])).toEqual(["j"]);
		const teamVersion = {
			title: "Clinic Tutor",
			pitch: "A tutor for clinics.",
			rolesNeeded: ["ml", "frontend"],
		};
		const { events, world: after } = await commit(
			world,
			fakeClient(
				{ a: ["j", "k"] },
				{ j: "a", k: "a" },
				{},
				{ a: teamVersion },
			).client,
		);
		expect(events.find((e) => e.type === "offers")).toMatchObject({
			to: ["j", "k"],
			ranked: ["j", "k"],
			teamVersion,
		});
		const pitches = events.flatMap((e) =>
			e.type === "bus" &&
			e.event.type === "sent" &&
			"kind" in e.event.message &&
			e.event.message.kind === "offer"
				? [e.event.message.pitch]
				: [],
		);
		expect(pitches).toEqual([
			"A tutor for clinics.",
			"A tutor for clinics.",
		]);
		expect(teamOf(after, "a")).toMatchObject({
			members: ["a", "j", "k"],
			project: {
				title: "Clinic Tutor",
				description: "A tutor for clinics.",
			},
		});
	});

	test("a team version that still reveals what one person shared is refused, and the offers stay as the checks left them", async () => {
		const world = twoVersionsCase();
		const { events } = await commit(
			world,
			fakeClient(
				{ a: ["j", "k"] },
				{ j: "a" },
				{},
				{
					a: {
						pitch: "An ML tutor for everyone.",
						rolesNeeded: ["ml", "frontend"],
					},
				},
			).client,
		);
		const offers = events.find((e) => e.type === "offers");
		expect(offers).toMatchObject({ to: ["j"] });
		expect(offers).not.toHaveProperty("teamVersion");
	});

	test("the project belongs to whoever wrote the agreed version, so an adopted revision can move it", () => {
		// a pitches; j counters with its own version (j's project now); then a revises, and j adopts it.
		const world = createWorld([human("a"), human("j", true, 4, "ml")]);
		ready(world, "a", "j");
		counterAccepted(world, "j", "a", "j's take on it.", ["frontend"]);
		expect(projectOwner(world, "a", "j")).toBe("j");
		const messages: AgentMessage[] = [
			{
				kind: "revision",
				from: "a",
				to: "j",
				level: 2,
				pitch: "a's take, with ML form feedback.",
				rolesNeeded: ["ml"],
			},
			{ kind: "revisionAnswer", from: "j", to: "a", adopt: true },
		];
		for (const m of messages) {
			world.agents.a = recordMessage(world.agents.a!, "j", m);
			world.agents.j = recordMessage(world.agents.j!, "a", m);
		}
		expect(projectOwner(world, "a", "j")).toBe("a");
		// a needs ml, which j has: j can be offered a place on a's team.
		expect(candidatesOf(world, "a")).toEqual(["j"]);
	});

	test("a joiner whose own revision was adopted can be offered a place, though it lists no role they fill", () => {
		// As p5 and p9 did: j (a designer with no idea of their own) asks to join a's project, a accepts, and at
		// level 2 j's revision is adopted. Its roles are what's needed from people other than j, so design isn't
		// in them; ownership falls back to a, who has the idea.
		const world = createWorld([human("a"), human("j", false, 4, "design")]);
		ready(world, "a", "j");
		const messages: AgentMessage[] = [
			{ decision: "accept", proposalId: "j-a", from: "a", to: "j" },
			{
				kind: "revision",
				from: "j",
				to: "a",
				level: 2,
				pitch: "A mobile-first take on a's project.",
				rolesNeeded: ["mobile", "backend"],
			},
			{ kind: "revisionAnswer", from: "a", to: "j", adopt: true },
		];
		for (const m of messages) {
			world.agents.a = recordMessage(world.agents.a!, "j", m);
			world.agents.j = recordMessage(world.agents.j!, "a", m);
		}
		expect(projectOwner(world, "a", "j")).toBe("a");
		expect(candidatesOf(world, "a")).toEqual(["j"]);
		expect(selectOffers(world, "a", ["j"])).toEqual(["j"]);
	});

	test("once a team exists, its version decides which roles are still needed", () => {
		const world = createWorld([human("a"), human("j", false)]);
		world.teams = [
			{
				id: "team-a",
				members: ["a", "j"],
				project: { title: "a's project", description: "Reshaped." },
				rolesNeeded: ["mobile", "data"],
				status: "committed",
			},
		];
		expect(stillNeeded(world, "a")).toEqual(["mobile", "data"]);
	});
});

describe("leaving a team", () => {
	// a's team with j already on it; k is ready to join, so the team grows and j re-checks.
	function growing() {
		const world = createWorld([
			human("a"),
			human("j", false),
			human("k", false, 4, "design"),
		]);
		world.teams = [
			{
				id: "team-a",
				members: ["a", "j"],
				project: { title: "a's project", description: "A project." },
				rolesNeeded: ["frontend", "design"],
				status: "committed",
			},
		];
		ready(world, "a", "k");
		return world;
	}

	test("when a team grows, only its earlier members re-check: not the owner or the newcomer", async () => {
		const { client, calls } = fakeClient({}, { k: "a" });
		const { events } = await commit(growing(), client);
		expect(
			events.filter((e) => e.type === "recheck").map((e) => e.agent),
		).toEqual(["j"]);
		expect(calls.filter((who) => who === "a")).toEqual([]);
	});

	test("a team that didn't grow has no re-checks", async () => {
		const world = createWorld([human("a"), human("j", false)]);
		ready(world, "a", "j");
		const { events } = await commit(
			world,
			fakeClient({}, { j: "a" }).client,
		);
		expect(events.some((e) => e.type === "recheck")).toBe(false);
	});

	test("the re-check prompt says leaving is costly and lists the teammates", async () => {
		const { client, prompts } = fakeClient({}, { k: "a" });
		await commit(growing(), client);
		expect(prompts.j).toContain("Leaving is costly");
		expect(prompts.j).toContain("the team is now 3 people");
		expect(prompts.j).toContain('\\"id\\":\\"k\\"');
	});

	test("a member who leaves tells every teammate, frees their place, and gets a public mark", async () => {
		const { client } = fakeClient({}, { k: "a" }, { j: "leave" });
		const result = await commit(growing(), client);
		expect(result.departures).toBe(1);
		expect(result.world.teams.map((t) => t.members)).toEqual([["a", "k"]]);
		expect(messagesOf(result.events)).toEqual(
			expect.arrayContaining(["j→a leave", "j→k leave"]),
		);
		expect(result.world.agents.j!.leftTeams).toBe(1);
		expect(isOpen(result.world, "j")).toBe(true);
		// Names already shared stay known: k learned j's name on joining, before j left.
		expect(contactOf(result.world.agents.k!, "j").learned.name).toBe(
			"Name of j",
		);
	});

	test("the owner doesn't offer the place back to someone who left", async () => {
		const { client } = fakeClient({}, { k: "a" }, { j: "leave" });
		const first = await commit(growing(), client);
		ready(first.world, "a", "j");
		const second = await commit(
			first.world,
			fakeClient({}, { j: "a" }).client,
		);
		expect(second.offers).toBe(0);
	});

	test("if no valid answer comes back, the member stays", async () => {
		const { client } = fakeClient({}, { k: "a" }, { j: "maybe" });
		const result = await commit(growing(), client);
		expect(result.world.teams[0]!.members).toEqual(["a", "j", "k"]);
		expect(result.events.find((e) => e.type === "recheck")).toMatchObject({
			decision: "stay",
			fellBack: true,
		});
	});

	test("the mark shows on the leaver's board entry and travels with their proposals, set by code", async () => {
		const world = createWorld([human("x"), human("y"), human("z")]);
		world.agents.x = { ...world.agents.x!, leftTeams: 2 };
		expect(buildBoard(world).find((e) => e.id === "x")).toMatchObject({
			leftTeams: 2,
		});
		expect(buildBoard(world).find((e) => e.id === "y")).not.toHaveProperty(
			"leftTeams",
		);
		// x and y both approach z; z approaches nobody.
		const fetch = (async (_url: unknown, init?: RequestInit) => {
			const { messages } = JSON.parse(init!.body as string);
			const who = /"id": "(\w+)"/.exec(messages[1].content)![1]!;
			const content = JSON.stringify({
				rationale: "Fits.",
				approach: who === "z" ? [] : ["z"],
			});
			return new Response(
				JSON.stringify({ choices: [{ message: { content } }] }),
			);
		}) as typeof globalThis.fetch;
		const { proposals } = await discover(
			createLlmClient(config, {
				fetch,
				retry: { sleep: async () => {} },
			}),
			world,
		);
		expect(proposals.find((p) => p.from === "x")).toMatchObject({
			leftTeams: 2,
		});
		expect(proposals.find((p) => p.from === "y")).not.toHaveProperty(
			"leftTeams",
		);
	});

	test("the recipient's decision prompt states the proposer's record", () => {
		const world = createWorld([human("x"), human("y")]);
		const [, user] = decisionMessages(world.agents.y!, {
			id: "p1",
			from: "x",
			to: "y",
			pitch: "x's project",
			rolesNeeded: ["design"],
			leftTeams: 1,
		});
		expect(user!.content).toContain(
			"their human has left 1 committed team before",
		);
	});
});

describe("brainstormed teams", () => {
	// j (frontend) and k (backend), neither with a project idea, brainstorm and both continue through level 2.
	// With `idea`, j then proposes one at level 2 and k adopts it.
	function brainstormed(idea: boolean) {
		const world = createWorld([
			human("j", false, 4, "frontend"),
			human("k", false, 4, "backend"),
		]);
		const messages: AgentMessage[] = [
			{
				id: "b5-j-k",
				from: "j",
				to: "k",
				pitch: BRAINSTORM_PITCH,
				rolesNeeded: ["backend", "design", "product"],
			},
			{ decision: "accept", proposalId: "b5-j-k", from: "k", to: "j" },
			...(["j", "k"] as const).map((from): AgentMessage => ({
				kind: "interest",
				from,
				to: from === "j" ? "k" : "j",
				level: 2,
				interest: "continue",
			})),
			...(idea
				? ([
						{
							kind: "revision",
							from: "j",
							to: "k",
							level: 2,
							pitch: "A study-group finder for night owls.",
							rolesNeeded: ["backend"],
						},
						{
							kind: "revisionAnswer",
							from: "k",
							to: "j",
							adopt: true,
						},
					] as AgentMessage[])
				: []),
		];
		for (const m of messages) {
			world.agents.j = recordMessage(world.agents.j!, "k", m);
			world.agents.k = recordMessage(world.agents.k!, "j", m);
		}
		for (const [self, other] of [
			["j", "k"],
			["k", "j"],
		] as const) {
			const { skills, preferences } = world.agents[other]!.profile;
			world.agents[self] = learn(world.agents[self]!, other, {
				skills,
				preferences,
			});
		}
		return world;
	}

	test("agreeing to brainstorm isn't an idea: nobody owns it and nobody can be offered a place", () => {
		const world = brainstormed(false);
		expect(projectOwner(world, "j", "k")).toBeUndefined();
		expect(candidatesOf(world, "j")).toEqual([]);
		expect(candidatesOf(world, "k")).toEqual([]);
	});

	test("whoever came up with the adopted idea owns it, even with no idea of their own, and the team forms", async () => {
		const world = brainstormed(true);
		expect(projectOwner(world, "k", "j")).toBe("j");
		expect(candidatesOf(world, "j")).toEqual(["k"]);
		const { world: after } = await commit(
			world,
			fakeClient({}, { k: "j" }).client,
		);
		expect(after.teams).toEqual([
			{
				id: "team-j",
				members: ["j", "k"],
				project: {
					title: "New project",
					description: "A study-group finder for night owls.",
				},
				rolesNeeded: ["backend"],
				status: "committed",
			},
		]);
	});
});

describe("comparing commitment options", () => {
	// Mo holds offers from ana (a team of 2) and ivo (just ivo), knows both owners' skills, and could lead a
	// team of their own with j instead.
	const mo = () => {
		let agent = createWorld([human("mo", true, 4, "frontend")]).agents.mo!;
		for (const [id, skill] of [
			["ana", "ml"],
			["ivo", "backend"],
			["j", "design"],
		] as const) {
			agent = learn(raiseLevel(agent, id, 2), id, {
				interests: ["education"],
				availability: { hoursPerWeek: 10, utcOffset: 0 },
				skills: [{ name: skill, level: "expert" }],
				preferences: {
					minTeamSize: 2,
					maxTeamSize: 4,
					preferredRoles: [skill],
				},
			});
		}
		return agent;
	};
	const offer = (from: string, pitch: string): Offer => ({
		kind: "offer",
		from,
		to: "mo",
		team: `team-${from}`,
		title: `${from} app`,
		pitch,
		rolesNeeded: ["frontend"],
	});

	test("every option, leading included, is shown in the same shape: version, team size, and facts", () => {
		const [system, user] = commitmentMessages(
			mo(),
			[
				offer("ana", "AI that triages on-call tickets."),
				offer("ivo", "A trip dashboard with smart AI suggestions."),
			],
			["j"],
			{
				sizes: { ana: 2, ivo: 1 },
				ownVersion: {
					title: "Mo app",
					pitch: "A study planner.",
					rolesNeeded: ["design"],
				},
			},
		);
		const text = system!.content;
		expect(text).toContain(GOOD_TEAM);
		expect(text).toContain(
			'Option ana: join ana\'s team (2 people now, 3 with your human), building {"title":"ana app","pitch":"AI that triages on-call tickets."',
		);
		expect(text).toContain(
			"Option ivo: join ivo's team (1 person now, 2 with your human), building",
		);
		expect(text).toContain(
			'Option null: lead your human\'s own project, building {"title":"Mo app","pitch":"A study planner."',
		);
		for (const id of ["ana", "ivo", "j"]) {
			expect(text).toContain(
				`Facts about you and ${id} (computed by code`,
			);
		}
		expect(text).toContain("Compare the options side by side");
		// The structured offers stay in the last message, with each team's size.
		expect(user!.content).toMatch(
			/^Offers: \[\{"owner":"ana",.*"teamSize":2/,
		);
	});

	test("without offers of its own, there's no lead option", () => {
		const [system] = commitmentMessages(mo(), [
			offer("ana", "AI that triages on-call tickets."),
		]);
		expect(system!.content).not.toContain("Option null");
		expect(system!.content).toContain("use null to decline them all");
	});
});
