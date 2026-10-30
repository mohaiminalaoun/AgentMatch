import { describe, expect, test } from "vitest";
import type { RunEvent } from "../../src/engine/events.js";
import type { Profile } from "../../src/engine/profile.js";
import {
	checkDecisions,
	describeFinding,
	profilesFrom,
} from "../../src/evaluation/decisions.js";

function profile(
	id: string,
	skills: Profile["skills"],
	sizes: [number, number] = [2, 4],
): Profile {
	return {
		id,
		name: `Name of ${id}`,
		skills,
		interests: ["education"],
		projectIdeas: [],
		availability: { hoursPerWeek: 10, utcOffset: 0 },
		preferences: {
			minTeamSize: sizes[0],
			maxTeamSize: sizes[1],
			preferredRoles: [],
		},
	};
}

// A model call whose system prompt holds `p`'s profile, as every agent prompt does; `user` and `reply` set
// what kind of call it was and what came back.
function call(
	p: Profile,
	user = "Keep going, or withdraw?",
	reply = "{}",
): RunEvent {
	return {
		type: "exchange",
		time: "2026-10-30T00:00:00.000Z",
		messages: [
			{ role: "system", content: "Reply with one JSON object." },
			{
				role: "system",
				content: `You are an AI agent.\n\nYour human's full profile (private; for your judgment only):\n${JSON.stringify(p, null, 2)}\n\nMore rules.`,
			},
			{ role: "user", content: user },
		],
		reply,
	};
}

const team = (
	id: string,
	members: string[],
	rolesNeeded: string[],
): RunEvent => ({
	type: "team",
	team: {
		id,
		members,
		project: { title: "P", description: "A project." },
		rolesNeeded,
		status: "committed",
	},
});

const a = profile("a", [{ name: "backend", level: "expert" }], [3, 4]);
const b = profile("b", [{ name: "design", level: "beginner" }], [2, 2]);
const c = profile("c", [{ name: "frontend", level: "expert" }]);

describe("profilesFrom", () => {
	test("reads each agent's own profile from its prompts, once", () => {
		const profiles = profilesFrom([call(a), call(a), call(b)]);
		expect([...profiles.keys()]).toEqual(["a", "b"]);
		expect(profiles.get("a")).toEqual(a);
	});
});

describe("checkDecisions", () => {
	test("finds teams outside a member's size limits, and roles nobody or only a beginner can do", () => {
		const report = checkDecisions([
			{
				type: "round",
				time: "t",
				model: "m",
				agents: ["a", "b", "c"],
			},
			call(a),
			call(b),
			call(c),
			team("team-a", ["a", "b"], ["design", "ml"]),
		]);
		expect(report).toMatchObject({
			teams: 1,
			placed: 2,
			people: 3,
			profiles: 3,
		});
		expect(report.findings.map(describeFinding)).toEqual([
			"team-a has 2 people; a wants at least 3",
			"team-a's project needs design, and only b (beginner) has it",
			"team-a's project needs ml, and no member has that skill",
		]);
	});

	test("the latest version of a team counts", () => {
		const report = checkDecisions([
			call(a),
			call(b),
			call(c),
			team("team-a", ["a", "b"], []),
			team("team-a", ["a", "b", "c"], []),
		]);
		expect(report.findings.map(describeFinding)).toEqual([
			"team-a has 3 people; b wants at most 2",
		]);
	});

	test("flags offers the code sent differently from what the owner's model chose", () => {
		const offersCall = (offer: string[]) =>
			call(
				a,
				"Choose who gets an offer, at most 2.",
				JSON.stringify({ rationale: "r", offer }),
			);
		const offers = (to: string[]): RunEvent => ({
			type: "offers",
			agent: "a",
			to,
			places: 2,
			fellBack: false,
		});
		const report = checkDecisions([
			offersCall(["b", "c"]),
			offers(["b"]),
			offersCall(["c"]),
			offers(["c"]),
			// No model call this time: nothing to compare.
			offers([]),
		]);
		expect(report.findings.map(describeFinding)).toEqual([
			"a's model chose b, c, but offers went to b",
		]);
	});
});
