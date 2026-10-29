import { describe, expect, it } from "vitest";
import {
	board,
	demoEvents,
	describe as describeEvent,
	ideaVersions,
	pairEvents,
	parseLog,
	project,
	type Event,
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
	it("keeps only what passed between two agents, in either direction", () => {
		const sent = (id: string, from: string, to: string) => ({
			type: "bus",
			event: {
				seq: 1,
				time: "t",
				type: "sent",
				message: {
					id,
					from,
					to,
					pitch: "An app.",
					rolesNeeded: ["design"],
				},
			},
		});
		const decision = (agent: string, proposalId: string) => ({
			type: "decision",
			agent,
			proposalId,
			decision: { decision: "accept" },
			gateBlocks: 0,
			fellBack: false,
		});
		const events = parseLog(
			[
				sent("r1-p1-p2", "p1", "p2"),
				sent("r1-p1-p3", "p1", "p3"),
				decision("p2", "r1-p1-p2"),
				decision("p3", "r1-p1-p3"),
				{ type: "level", agent: "p2", other: "p1", from: 0, to: 1 },
				{ type: "level", agent: "p1", other: "p3", from: 0, to: 1 },
				{ type: "tick", n: 2 },
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		expect(pairEvents(events, "p2", "p1").map(describeEvent)).toEqual([
			"p1 → p2: proposes “An app.” · needs design",
			"p2 accepted a proposal",
			"p2 ↔ p1 unlocked level 1",
		]);
	});
	it("tracks each version of the idea and the one agreed now", () => {
		const sent = (message: object) => ({
			type: "bus",
			event: { seq: 1, time: "t", type: "sent", message },
		});
		const events = parseLog(
			[
				sent({
					id: "r1",
					from: "p1",
					to: "p2",
					pitch: "A recipe app.",
					rolesNeeded: ["design"],
				}),
				sent({
					proposalId: "r1",
					from: "p2",
					to: "p1",
					decision: "counter",
					pitch: "A meal planner.",
					rolesNeeded: ["design", "backend"],
				}),
				sent({
					proposalId: "r1.c",
					from: "p1",
					to: "p2",
					decision: "accept",
				}),
				sent({
					kind: "revision",
					from: "p1",
					to: "p2",
					level: 1,
					pitch: "A family meal planner.",
					rolesNeeded: ["backend"],
				}),
				sent({
					kind: "revisionAnswer",
					from: "p2",
					to: "p1",
					adopt: false,
				}),
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		const { versions, agreed } = ideaVersions(events, "p1", "p2");
		expect(versions.map((v) => [v.how, v.author, v.status])).toEqual([
			["proposal", "p1", "countered"],
			["counter", "p2", "accepted"],
			["revision", "p1", "kept"],
		]);
		expect(agreed).toBe(1);
	});
	it("settles crossing revisions by who each answer replies to", () => {
		const sent = (message: object) => ({
			type: "bus",
			event: { seq: 1, time: "t", type: "sent", message },
		});
		const revision = (from: string, to: string, roles: string[]) =>
			sent({
				kind: "revision",
				from,
				to,
				level: 2,
				pitch: "A civic platform.",
				rolesNeeded: roles,
			});
		const events = parseLog(
			[
				sent({
					id: "r1",
					from: "p9",
					to: "p11",
					pitch: "Join your project: A civic app.",
					rolesNeeded: ["design"],
				}),
				sent({
					proposalId: "r1",
					from: "p11",
					to: "p9",
					decision: "accept",
				}),
				revision("p9", "p11", ["backend"]),
				revision("p11", "p9", ["product"]),
				sent({
					kind: "revisionAnswer",
					from: "p11",
					to: "p9",
					adopt: true,
				}),
				sent({
					kind: "revisionAnswer",
					from: "p9",
					to: "p11",
					adopt: false,
				}),
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		const { versions, agreed } = ideaVersions(events, "p9", "p11");
		expect(versions.map((v) => [v.author, v.to, v.status])).toEqual([
			["p11", "p11", "accepted"],
			["p9", "p11", "adopted"],
			["p11", "p9", "kept"],
		]);
		expect(versions[0]?.pitch).toBe("A civic app.");
		expect(agreed).toBe(1);
	});
	it("builds the public board: listings, people looking to join, and each one's status", () => {
		const team = (id: string, members: string[]): Event => ({
			type: "team",
			team: {
				id,
				members,
				project: { title: "T", description: "D" },
				rolesNeeded: [],
				status: "committed",
			},
		});
		const listing = (agent: string): Event => ({
			type: "listing",
			agent,
			pitch: `${agent}'s idea`,
			rolesNeeded: ["design"],
			gateBlocks: 0,
			fellBack: false,
		});
		const discovery = (agent: string, approach: string[]): Event => ({
			type: "discovery",
			agent,
			approach,
			fellBack: false,
		});
		const events: Event[] = [
			listing("ana"),
			listing("ben"),
			listing("cy"),
			{
				type: "round",
				time: "",
				model: "",
				agents: ["ana", "ben", "cy", "dee", "eli"],
			},
			discovery("ana", ["dee", "ben"]),
			discovery("cy", ["ben"]),
			team("t-ana", ["ana", "dee"]),
			team("t-cy", ["cy", "eli"]),
			// eli leaves, which dissolves cy's team without a team event.
			{
				type: "recheck",
				agent: "eli",
				team: "t-cy",
				decision: "leave",
				fellBack: false,
			},
		];
		const byId = (es: Event[]) =>
			Object.fromEntries(board(es).map((b) => [b.id, b]));
		const before = byId(events);
		expect(board(events).map((b) => b.id)).toEqual([
			"ana",
			"ben",
			"cy",
			"dee",
			"eli",
		]);
		expect(before.ana).toMatchObject({ status: "owner", approachedBy: 0 });
		expect(before.ben).toMatchObject({
			pitch: "ben's idea",
			status: "exploring",
			approachedBy: 2,
		});
		expect(before.cy?.status).toBe("exploring");
		expect(before.dee).toMatchObject({
			status: "member",
			joined: "ana",
			rolesNeeded: [],
			approachedBy: 1,
		});
		expect(before.dee?.pitch).toBeUndefined();
		expect(before.ana?.joined).toBeUndefined();
		expect(before.eli).toMatchObject({ status: "exploring", leftTeams: 1 });
		// Discovery only runs for owners with places left.
		expect(byId([...events, discovery("ana", [])]).ana?.status).toBe(
			"owner-open",
		);
	});
});
