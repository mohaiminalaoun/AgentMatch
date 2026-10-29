import { describe, expect, test } from "vitest";
import { RunEvent } from "../../src/engine/events.js";
import { eventsFor } from "../../src/pilot/view.js";

// Something private to `id`: any of these reaching anyone else's view is a leak.
const secret = (id: string) => `SECRET-${id}`;

const sent = (message: object, seq = 1): RunEvent => ({
	type: "bus",
	event: { seq, time: "t", type: "sent", message } as never,
});

const team = (id: string, members: string[]): RunEvent => ({
	type: "team",
	team: {
		id,
		members,
		project: { title: "T", description: "D" },
		rolesNeeded: [],
		status: "committed",
	},
});

// A run with a, b, and c touching every kind of event. a and b talk and form a team that c joins and
// then leaves; b and c also talk to each other, which a never sees.
const run: RunEvent[] = [
	{ type: "round", time: "t", model: "m", agents: ["a", "b", "c"] },
	...["a", "b", "c"].map((id): RunEvent => ({
		type: "listing",
		agent: id,
		pitch: `${id}'s idea`,
		rolesNeeded: ["design"],
		rationale: secret(id),
		gateBlocks: 0,
		fellBack: false,
	})),
	...["a", "b", "c"].map((id): RunEvent => ({
		type: "discovery",
		agent: id,
		approach: id === "a" ? ["b"] : ["c"],
		rationale: secret(id),
		fellBack: false,
	})),
	{ type: "tick", n: 1 },
	sent({
		id: "r1-a-b",
		from: "a",
		to: "b",
		pitch: "a's idea",
		rolesNeeded: ["design"],
	}),
	sent({
		id: "r1-b-c",
		from: "b",
		to: "c",
		pitch: "b's idea",
		rolesNeeded: ["design"],
	}),
	{
		type: "bus",
		event: {
			seq: 3,
			time: "t",
			type: "rejected",
			from: "c",
			reason: secret("c"),
		},
	},
	...["b", "c"].map((id): RunEvent => ({
		type: "decision",
		agent: id,
		proposalId: id === "b" ? "r1-a-b" : "r1-b-c",
		decision: { decision: "accept" },
		rationale: secret(id),
		gateBlocks: 0,
		fellBack: false,
	})),
	...[
		["a", "b"],
		["b", "a"],
		["b", "c"],
		["c", "b"],
	].flatMap(([agent, other]): RunEvent[] => [
		{ type: "level", agent: agent!, other: other!, from: 0, to: 1 },
		{
			type: "hunch",
			agent: agent!,
			other: other!,
			steer: "careful",
			riskArea: "scope",
			rationale: secret(agent!),
			fellBack: false,
		},
		{
			type: "interest",
			agent: agent!,
			other: other!,
			level: 1,
			interest: "continue",
			revision: { pitch: secret(agent!), rolesNeeded: ["ml"] },
			rationale: secret(agent!),
			fellBack: false,
		},
		{
			type: "revisionAnswer",
			agent: agent!,
			other: other!,
			adopt: true,
			rationale: secret(agent!),
			fellBack: false,
		},
	]),
	sent({
		kind: "share",
		from: "c",
		to: "b",
		level: 1,
		shared: { interests: ["shared-by-c"] },
	}),
	...["a", "b"].map((id): RunEvent => ({
		type: "offers",
		agent: id,
		to: id === "a" ? ["b"] : ["c"],
		places: 1,
		rationale: secret(id),
		fellBack: false,
	})),
	...["b", "c"].map((id): RunEvent => ({
		type: "commitment",
		agent: id,
		offers: ["a"],
		chose: "a",
		rationale: secret(id),
		fellBack: false,
	})),
	team("team-a", ["a", "b"]),
	team("team-a", ["a", "b", "c"]),
	{
		type: "recheck",
		agent: "c",
		team: "team-a",
		decision: "leave",
		rationale: secret("c"),
		fellBack: false,
	},
	team("team-a", ["a", "b"]),
	team("team-x", ["c", "x"]),
	{ type: "stopped", rounds: 1, reason: "stable" },
	{ type: "brainstorm", agents: ["b", "c", "z"] },
	{
		type: "exchange",
		time: "t",
		messages: [{ role: "user", content: secret("a") }],
		reply: secret("a"),
	} as RunEvent,
];

describe("eventsFor", () => {
	test("the fixture covers every kind of run event, so none slips past the filter unreviewed", () => {
		const kinds = RunEvent.options.map((o) => o.shape.type.value);
		expect(new Set(run.map((e) => e.type))).toEqual(new Set(kinds));
	});

	test.each(["a", "b", "c"])(
		"%s's view holds nothing private to anyone else, and no model calls",
		(id) => {
			const view = eventsFor(id, run);
			const text = JSON.stringify(view);
			for (const other of ["a", "b", "c"].filter((o) => o !== id)) {
				expect(text).not.toContain(secret(other));
			}
			expect(view.some((e) => e.type === "exchange")).toBe(false);
		},
	);

	test("a sees their own reasoning, their conversations, the public board, and their team", () => {
		const view = eventsFor("a", run);
		const text = JSON.stringify(view);
		expect(text).toContain(secret("a"));
		// Everyone's public listing, without anyone else's reasoning.
		expect(
			view.filter((e) => e.type === "listing").map((e) => e.agent),
		).toEqual(["a", "b", "c"]);
		// Messages to or from a only: never b and c's conversation.
		expect(
			view.flatMap((e) =>
				e.type === "bus" && e.event.type === "sent"
					? [`${e.event.message.from}→${e.event.message.to}`]
					: [],
			),
		).toEqual(["a→b"]);
		expect(view.filter((e) => e.type === "team")).toHaveLength(3);
		expect(view.some((e) => e.type === "brainstorm")).toBe(false);
	});

	test("someone who left a team still sees it change, but not teams they were never on", () => {
		const teams = eventsFor("c", run).flatMap((e) =>
			e.type === "team" ? [e.team.members.join(",")] : [],
		);
		expect(teams).toEqual(["a,b,c", "a,b", "c,x"]);
	});

	test("in the brainstorm, each person learns only that they're in it", () => {
		expect(
			eventsFor("b", run).find((e) => e.type === "brainstorm"),
		).toEqual({ type: "brainstorm", agents: ["b"] });
	});
});
