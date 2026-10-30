import { describe, expect, test } from "vitest";
import { createAgent, learn, raiseLevel } from "../../src/engine/agent.js";
import {
	factsText,
	fitFacts,
	timeZoneGap,
	workdayOverlapHours,
} from "../../src/engine/fit.js";
import type { Profile } from "../../src/engine/profile.js";

const riya: Profile = {
	id: "p-riya",
	name: "Riya",
	skills: [
		{ name: "backend", level: "expert" },
		{ name: "data", level: "intermediate" },
	],
	interests: ["health", "AI"],
	projectIdeas: [],
	availability: { hoursPerWeek: 10, utcOffset: -5 },
	preferences: { minTeamSize: 2, maxTeamSize: 4, preferredRoles: [] },
};

// What p-leo shares at each level. Leo's name and anything else never shared must not show up.
const leoLevel1 = {
	interests: ["AI", "climate"],
	availability: { hoursPerWeek: 28, utcOffset: 2 },
};
const leoLevel2 = {
	skills: [{ name: "devops", level: "expert" as const }],
	preferences: { minTeamSize: 3, maxTeamSize: 5, preferredRoles: ["devops"] },
};

const atLevel = (level: 0 | 1 | 2) => {
	let agent = raiseLevel(createAgent(riya), "p-leo", level);
	if (level >= 1) agent = learn(agent, "p-leo", leoLevel1);
	if (level >= 2) agent = learn(agent, "p-leo", leoLevel2);
	return agent;
};

describe("workdayOverlapHours and timeZoneGap", () => {
	test("the same zone overlaps a whole assumed workday; 7 hours apart, one hour", () => {
		expect(workdayOverlapHours([-5, -5])).toBe(8);
		expect(workdayOverlapHours([-5, 2])).toBe(1);
		expect(workdayOverlapHours([-5, 8])).toBe(0);
		expect(workdayOverlapHours([])).toBe(0);
	});

	test("the gap goes the short way around the clock", () => {
		expect(timeZoneGap(-5, 2)).toBe(7);
		expect(timeZoneGap(-10, 12)).toBe(2);
	});
});

describe("fitFacts", () => {
	test("at level 0, only your own side is known, and their logistics and skills are listed as unknown", () => {
		const facts = fitFacts(atLevel(0), "p-leo");
		expect(facts.them).toEqual({});
		expect(facts.timeZoneGap).toBeUndefined();
		const text = factsText(facts);
		expect(text).toContain(
			"Your human's skills: backend (expert), data (intermediate).",
		);
		expect(text).toContain(
			"p-leo's interests, time zone, and weekly hours: not shared yet",
		);
		expect(text).toContain(
			"Don't assume they have any skill or would fill any role.",
		);
		expect(text).not.toContain("Estimates");
	});

	test("at level 1, time zones, hours, and shared interests are facts, and the overlap is an estimate", () => {
		const facts = fitFacts(atLevel(1), "p-leo");
		expect(facts).toMatchObject({
			timeZoneGap: 7,
			workdayOverlap: 1,
			sharedInterests: ["AI"],
		});
		expect(facts.sizesForBoth).toBeUndefined();
		const text = factsText(facts);
		expect(text).toContain(
			"Time zones: your human UTC-5, p-leo UTC+2 (7 hours apart).",
		);
		expect(text).toContain("Hours a week: your human 10, p-leo 28.");
		expect(text).toContain("Interests both listed, word for word: AI.");
		expect(text).toContain(
			"their working days would overlap about 1 hour a day. That is an assumption, not a fact",
		);
		expect(text).toContain("p-leo's skills and team size: not shared yet");
		expect(text).not.toContain("p-leo's interests, time zone");
	});

	test("at level 2, skills and the sizes that suit both are facts", () => {
		const facts = fitFacts(atLevel(2), "p-leo");
		expect(facts.sizesForBoth).toEqual([3, 4]);
		const text = factsText(facts);
		expect(text).toContain("p-leo's skills: devops (expert).");
		expect(text).toContain(
			"Team size: your human wants 2 to 4 people, p-leo wants 3 to 5; sizes that suit both: 3 to 4.",
		);
		expect(text).not.toContain("not shared yet");
	});

	test("always says what a profile can't tell: meeting times, unlisted roles, and role count versus headcount", () => {
		const text = factsText(fitFacts(atLevel(2), "p-leo"));
		expect(text).toContain("When anyone actually works or can meet");
		expect(text).toContain("Roles a pitch doesn't list: unknown.");
		expect(text).toContain(
			"the number of roles isn't the number of people",
		);
	});

	test("says when no team size suits both, and when no interest matches word for word", () => {
		let agent = raiseLevel(createAgent(riya), "p-leo", 2);
		agent = learn(agent, "p-leo", {
			interests: ["music"],
			preferences: { minTeamSize: 5, maxTeamSize: 6, preferredRoles: [] },
		});
		const text = factsText(fitFacts(agent, "p-leo"));
		expect(text).toContain("no size suits both");
		expect(text).toContain("No interest is listed by both word for word.");
	});

	test("never contains anything the other side hasn't shared", () => {
		const text = factsText(fitFacts(atLevel(1), "p-leo"));
		expect(text).not.toContain("devops");
		expect(text).not.toContain("Leo");
	});
});
