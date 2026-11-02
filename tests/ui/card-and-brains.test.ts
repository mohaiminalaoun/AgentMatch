import { describe, expect, it } from "vitest";
import {
	board,
	brains,
	cardOf,
	describe as describeEvent,
	ideaVersions,
	parseLog,
	project,
	type Event,
} from "../../src/ui/web/replay.js";

const log = (events: object[]): Event[] =>
	parseLog(events.map((e) => JSON.stringify(e)).join("\n"));

const sent = (message: object) => ({
	type: "bus",
	event: { seq: 1, time: "t", type: "sent", message },
});

const card = {
	problem: "Teams can't stop a risky tool call before it runs.",
	build: "A proxy, a policy file, and a live log.",
	roleWork: { frontend: "a dashboard for blocked calls", design: "a logo" },
};

describe("project cards", () => {
	it("keeps only well-formed parts, and role work only for the roles needed", () => {
		expect(cardOf(card, ["frontend"])).toEqual({
			problem: card.problem,
			build: card.build,
			roleWork: { frontend: "a dashboard for blocked calls" },
		});
		expect(cardOf({ problem: 3, pitch: "x" })).toEqual({});
		expect(cardOf({ pitch: "An older log." })).toEqual({});
	});

	it("every version of an idea carries its card, and versions from older logs carry none", () => {
		const events = log([
			sent({
				id: "r1",
				from: "c1",
				to: "p-me",
				title: "Firewall",
				pitch: "A policy proxy for agents.",
				rolesNeeded: ["frontend"],
				...card,
			}),
			sent({
				proposalId: "r1",
				from: "p-me",
				to: "c1",
				decision: "counter",
				pitch: "A firewall with an audit trail.",
				rolesNeeded: ["design"],
			}),
		]);
		const { versions } = ideaVersions(events, "c1", "p-me");
		expect(versions.map((v) => v.card)).toEqual([
			{
				problem: card.problem,
				build: card.build,
				roleWork: { frontend: "a dashboard for blocked calls" },
			},
			{},
		]);
	});

	it("listings put their card on the board and on the agent", () => {
		const events = log([
			{
				type: "listing",
				agent: "c1",
				title: "Firewall",
				pitch: "A policy proxy for agents.",
				rolesNeeded: ["frontend"],
				...card,
				gateBlocks: 0,
				fellBack: false,
			},
		]);
		const expected = {
			problem: card.problem,
			build: card.build,
			roleWork: { frontend: "a dashboard for blocked calls" },
		};
		expect(board(events)[0]).toMatchObject(expected);
		expect(project(events).people[0]).toMatchObject(expected);
	});
});

describe("brains", () => {
	it("reads which agents had a brain of their own from the brains event", () => {
		const events = log([
			{
				type: "brains",
				agents: { "p-me": "mailbox:muse", p1: "muse-wonder-1.0" },
			},
		]);
		expect(brains(events)).toEqual(
			new Map([
				["p-me", { kind: "outside", name: "muse" }],
				["p1", { kind: "model", model: "muse-wonder-1.0" }],
			]),
		);
		expect(describeEvent(events[0]!)).toBe(
			"p-me answered through the mailbox as an outside agent (muse); the arena checked every answer the same way · p1 thought with a different model (muse-wonder-1.0); the arena checked every answer the same way",
		);
	});

	it("in older logs, finds an outside agent from the model calls its mailbox answered", () => {
		const exchange = (model: string, id: string) => ({
			type: "exchange",
			time: "t",
			model,
			messages: [
				{ role: "system", content: 'Reply as JSON: {"id":{}}' },
				{
					role: "system",
					content: `Your human's profile:\n{\n  "id": "${id}",\n  "name": "X"\n}`,
				},
			],
			reply: "{}",
		});
		const events = log([
			exchange("muse-spark-1.3", "c1"),
			exchange("mailbox:muse", "p-me"),
			exchange("mailbox:muse", "p-me"),
		]);
		expect(brains(events)).toEqual(
			new Map([["p-me", { kind: "outside", name: "muse" }]]),
		);
	});

	it("a log with neither has no agents with brains of their own", () => {
		expect(brains(log([{ type: "tick", n: 1 }])).size).toBe(0);
	});
});

describe("offers in a version's history", () => {
	const proposal = sent({
		id: "r1",
		from: "c1",
		to: "p-me",
		title: "Firewall",
		pitch: "A policy proxy for agents.",
		rolesNeeded: ["frontend"],
		...card,
	});
	const accept = sent({
		proposalId: "r1",
		from: "p-me",
		to: "c1",
		decision: "accept",
	});
	const answer = sent({
		kind: "answer",
		from: "p-me",
		to: "c1",
		team: "team-c1",
		answer: "commit",
	});

	it("an offer that repeats the agreed version is a step on it, not a new version", () => {
		const offer = sent({
			kind: "offer",
			from: "c1",
			to: "p-me",
			team: "team-c1",
			title: "Firewall",
			pitch: "A policy proxy for agents.",
			rolesNeeded: ["frontend"],
			...card,
		});
		const { versions, agreed } = ideaVersions(
			log([proposal, accept, offer, answer]),
			"c1",
			"p-me",
		);
		expect(versions).toHaveLength(1);
		expect(versions[0]!.status).toBe("accepted");
		expect(versions[0]!.offers?.map((o) => [o.from, o.status])).toEqual([
			["c1", "committed"],
		]);
		expect(agreed).toBe(0);
	});

	it("an offer that changes anything, even only the roles, is a version of its own", () => {
		const offer = sent({
			kind: "offer",
			from: "c1",
			to: "p-me",
			team: "team-c1",
			title: "Firewall",
			pitch: "A policy proxy for agents.",
			rolesNeeded: ["frontend", "ml"],
			...card,
		});
		const { versions, agreed } = ideaVersions(
			log([proposal, accept, offer, answer]),
			"c1",
			"p-me",
		);
		expect(versions.map((v) => [v.how, v.status])).toEqual([
			["proposal", "accepted"],
			["offer", "committed"],
		]);
		expect(versions[0]!.offers).toBeUndefined();
		expect(agreed).toBe(1);
	});
});
