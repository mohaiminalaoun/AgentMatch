import { describe, expect, test } from "vitest";
import {
	contactOf,
	createAgent,
	learn,
	raiseLevel,
	recordMessage,
	recordRevealed,
	type AgentState,
} from "../../src/engine/agent.js";
import type { Proposal } from "../../src/engine/proposal.js";
import { sampleProfile } from "../fixtures.js";

const proposal: Proposal = {
	id: "prop-1",
	from: "p1",
	to: "p2",
	pitch: "A carbon tracker for households.",
	rolesNeeded: ["backend"],
};

// Freezes an object and everything inside it, so any attempt to change it throws.
function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.values(value).forEach(deepFreeze);
		Object.freeze(value);
	}
	return value;
}

// An agent that has already met p2 once, frozen to catch in-place changes.
function metAgent(): AgentState {
	const agent = raiseLevel(
		recordMessage(createAgent(sampleProfile), "p2", proposal),
		"p2",
		1,
	);
	return deepFreeze(agent);
}

describe("createAgent", () => {
	test("uses the profile's id and starts with no contacts", () => {
		const agent = createAgent(sampleProfile);
		expect(agent.id).toBe(sampleProfile.id);
		expect(agent.profile).toBe(sampleProfile);
		expect(agent.contacts).toEqual({});
	});
});

describe("contactOf", () => {
	test("someone the agent hasn't met is at level 0 and known for nothing", () => {
		expect(contactOf(createAgent(sampleProfile), "stranger")).toEqual({
			level: 0,
			revealed: [],
			learned: {},
			history: [],
		});
	});

	test("looking someone up doesn't add them as a contact", () => {
		const agent = createAgent(sampleProfile);
		contactOf(agent, "stranger");
		expect(agent.contacts).toEqual({});
	});
});

describe("raiseLevel", () => {
	test("moves the relationship up", () => {
		const agent = raiseLevel(createAgent(sampleProfile), "p2", 2);
		expect(contactOf(agent, "p2").level).toBe(2);
	});

	test("never lowers it", () => {
		const agent = raiseLevel(
			raiseLevel(createAgent(sampleProfile), "p2", 2),
			"p2",
			1,
		);
		expect(contactOf(agent, "p2").level).toBe(2);
	});

	test("levels are per contact", () => {
		const agent = raiseLevel(createAgent(sampleProfile), "p2", 2);
		expect(contactOf(agent, "p3").level).toBe(0);
	});
});

describe("recordRevealed", () => {
	test("keeps each field once, in the order first revealed", () => {
		let agent = recordRevealed(createAgent(sampleProfile), "p2", [
			"projectIdeas",
		]);
		agent = recordRevealed(agent, "p2", ["interests", "projectIdeas"]);
		expect(contactOf(agent, "p2").revealed).toEqual([
			"projectIdeas",
			"interests",
		]);
	});
});

describe("learn", () => {
	test("merges new fields without erasing earlier ones", () => {
		let agent = learn(createAgent(sampleProfile), "p2", {
			interests: ["climate"],
		});
		agent = learn(agent, "p2", {
			availability: { hoursPerWeek: 10, utcOffset: 1 },
		});
		expect(contactOf(agent, "p2").learned).toEqual({
			interests: ["climate"],
			availability: { hoursPerWeek: 10, utcOffset: 1 },
		});
	});

	test("what's learned about one contact stays with that contact", () => {
		const agent = learn(createAgent(sampleProfile), "p2", {
			interests: ["climate"],
		});
		expect(contactOf(agent, "p3").learned).toEqual({});
	});
});

describe("recordMessage", () => {
	test("adds messages to the history, oldest first", () => {
		const response = {
			decision: "decline" as const,
			proposalId: "prop-1",
			from: "p2",
			to: "p1",
		};
		let agent = recordMessage(createAgent(sampleProfile), "p2", proposal);
		agent = recordMessage(agent, "p2", response);
		expect(contactOf(agent, "p2").history).toEqual([proposal, response]);
	});
});

describe("state is never changed in place", () => {
	test("every update returns a new state and leaves the old one intact", () => {
		const before = metAgent();
		const snapshot = JSON.stringify(before);
		const after = learn(
			recordRevealed(
				recordMessage(raiseLevel(before, "p2", 3), "p2", proposal),
				"p2",
				["skills"],
			),
			"p2",
			{ interests: ["music"] },
		);
		expect(after).not.toBe(before);
		expect(JSON.stringify(before)).toBe(snapshot);
	});

	test("a state survives a JSON round trip unchanged", () => {
		const agent = learn(
			recordRevealed(metAgent(), "p2", ["projectIdeas"]),
			"p2",
			{ interests: ["climate"] },
		);
		expect(JSON.parse(JSON.stringify(agent))).toEqual(agent);
	});

	test("an agent can't have itself as a contact", () => {
		const agent = createAgent(sampleProfile);
		expect(() => raiseLevel(agent, agent.id, 1)).toThrow();
	});
});
