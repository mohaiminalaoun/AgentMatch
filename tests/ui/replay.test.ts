import { describe, expect, it } from "vitest";
import {
	demoEvents,
	describe as describeEvent,
	parseLog,
	project,
} from "../../src/ui/web/replay.js";
describe("browser replay", () => {
	it("rejects malformed events before they reach rendering", () => {
		expect(() => parseLog('{"type":"team","team":{"id":"bad"}}')).toThrow(
			"Line 1: malformed team",
		);
		expect(() =>
			parseLog('{"type":"discovery","agent":"a","approach":null}'),
		).toThrow("malformed discovery");
		expect(() => parseLog("not json")).toThrow("Line 1: invalid JSON");
	});
	it("replays JSONL in order and updates a team instead of duplicating it", () => {
		const events = parseLog(
			demoEvents.map((e) => JSON.stringify(e)).join("\n"),
		);
		expect(project(events.slice(0, 12)).teams).toHaveLength(0);
		const result = project(events);
		expect(result.people).toHaveLength(12);
		expect(result.teams).toHaveLength(3);
		expect(result.gates).toBe(1);
		const team = result.teams[0]!;
		const changed = { ...team, members: team.members.slice(0, 2) };
		const updated = project([...events, { type: "team", team: changed }]);
		expect(updated.teams).toHaveLength(3);
		expect(updated.teams[0]?.members).toHaveLength(2);
	});
	it("accepts additional fields and future event types", () => {
		expect(parseLog('{"type":"future-event","extra":true}')).toHaveLength(
			1,
		);
		expect(
			project(parseLog('{"type":"future-event","extra":true}')).teams,
		).toHaveLength(0);
	});
	it("describes the newer engine events: revisions, hunches, brainstorming, and stopping", () => {
		const events = parseLog(
			[
				{
					type: "interest",
					agent: "theo",
					other: "mara",
					level: 2,
					interest: "continue",
					revision: {
						pitch: "Rehab coach with pose feedback.",
						rolesNeeded: ["ml"],
					},
					gateBlocks: 0,
					fellBack: false,
				},
				{
					type: "revisionAnswer",
					agent: "mara",
					other: "theo",
					adopt: true,
					fellBack: false,
				},
				{
					type: "hunch",
					agent: "rafa",
					other: "lena",
					steer: "careful",
					riskArea: "retention",
					rationale: "His jiu-jitsu app lost users.",
					fellBack: false,
				},
				{ type: "brainstorm", agents: ["p2", "p4"] },
				{ type: "stopped", rounds: 4, reason: "stable" },
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		expect(events.map(describeEvent)).toEqual([
			"theo continued with mara and proposed a new version: “Rehab coach with pose feedback.”",
			"mara adopted theo’s new version of the idea",
			"rafa checked privately with their human’s notes",
			"2 people without a team start brainstorming together",
			"Run settled after 4 rounds",
		]);
		// The hunch's steer and reasoning stay out of the public description.
		expect(describeEvent(events[2]!)).not.toMatch(/careful|retention|jiu/);
	});
	it("counts gate blocks whether or not an interest event carries them", () => {
		const events = parseLog(
			[
				{
					type: "interest",
					agent: "a",
					other: "b",
					level: 1,
					interest: "continue",
					fellBack: false,
				},
				{
					type: "interest",
					agent: "b",
					other: "a",
					level: 1,
					interest: "continue",
					gateBlocks: 2,
					fellBack: false,
				},
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		expect(project(events).gates).toBe(2);
	});
	it("shows public listings and counters in full", () => {
		const events = parseLog(
			[
				{
					type: "listing",
					agent: "p3",
					pitch: "A developer tools app.",
					rolesNeeded: ["frontend", "backend"],
					gateBlocks: 0,
					fellBack: false,
				},
				{
					type: "decision",
					agent: "p8",
					proposalId: "r1-p3-p8",
					decision: {
						decision: "counter",
						pitch: "A developer tools API.",
						rolesNeeded: ["frontend"],
					},
					gateBlocks: 0,
					fellBack: false,
				},
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		expect(events.map(describeEvent)).toEqual([
			"p3 posted: “A developer tools app.” · needs frontend, backend",
			"p8 countered: “A developer tools API.”",
		]);
	});
});
