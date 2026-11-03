import { describe, expect, it } from "vitest";
import {
	board,
	codeNotes,
	demoEvents,
	describe as describeEvent,
	describeMessage,
	factsFor,
	ideaVersions,
	pairEvents,
	parseLog,
	project,
	teamStory,
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
	it("drops a team whose member leaves it with only its owner", () => {
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
		const leave = (agent: string, team: string): Event => ({
			type: "recheck",
			agent,
			team,
			decision: "leave",
			fellBack: false,
		});
		const events = [
			team("t-ana", ["ana", "ben", "cy"]),
			team("t-dee", ["dee", "eli"]),
			// The engine sends the smaller team when two or more remain, but nothing when one does.
			leave("cy", "t-ana"),
			team("t-ana", ["ana", "ben"]),
			leave("eli", "t-dee"),
		];
		expect(project(events).teams.map((t) => t.members)).toEqual([
			["ana", "ben"],
		]);
	});
	it("at the deadline, whoever drops out leaves their group, which dissolves below two, with no mark against them", () => {
		const tentative = (id: string, members: string[]): Event => ({
			type: "team",
			team: {
				id,
				members,
				project: { title: "T", description: "D" },
				rolesNeeded: [],
				status: "tentative",
			},
		});
		const answer = (
			agent: string,
			team: string,
			confident: boolean,
		): Event => ({
			type: "lock",
			agent,
			team,
			ask: 1,
			confident,
			rationale: "Weighed it.",
			fellBack: false,
		});
		const events = parseLog(
			[
				{
					type: "round",
					time: "",
					model: "",
					agents: ["ana", "ben", "cy", "dee", "eli"],
				},
				tentative("t-ana", ["ana", "ben", "cy"]),
				tentative("t-dee", ["dee", "eli"]),
				answer("ana", "t-ana", true),
				answer("cy", "t-ana", false),
				answer("eli", "t-dee", false),
				{
					type: "team",
					team: {
						id: "t-ana",
						members: ["ana", "ben"],
						project: { title: "T", description: "D" },
						rolesNeeded: [],
						status: "committed",
					},
				},
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		expect(project(events).teams).toEqual([
			expect.objectContaining({
				members: ["ana", "ben"],
				status: "committed",
			}),
		]);
		const entries = Object.fromEntries(board(events).map((b) => [b.id, b]));
		expect(entries.cy).toMatchObject({ status: "exploring", leftTeams: 0 });
		expect(describeEvent(events[4]!)).toBe(
			"cy dropped out of their group at the deadline",
		);
		expect(describeEvent(events[3]!)).toBe(
			"ana confirmed their group at the deadline",
		);
		const story = teamStory(events, {
			id: "t-ana",
			members: ["ana", "ben"],
			project: { title: "T", description: "D" },
			rolesNeeded: [],
			status: "committed",
		});
		expect(story.steps.map((s) => `${s.who} ${s.what}`)).toEqual([
			"ana confirmed",
			"cy dropped",
		]);
	});
	it("pairs each private rationale with the facts its model call was given", () => {
		const exchange: Event = {
			type: "exchange",
			time: "t",
			messages: [
				{ role: "system", content: "Reply with one JSON object." },
				{
					role: "system",
					content:
						"You are an agent.\n\nFacts about you and p9 (computed by code):\n- Time zones: 2 hours apart.\n\nRules.",
				},
				{ role: "user", content: "Keep going, or withdraw?" },
			],
			reply: JSON.stringify({
				rationale: "Close time zones.",
				interest: "continue",
			}),
		};
		const interest: Event = {
			type: "interest",
			agent: "a",
			other: "p9",
			level: 1,
			interest: "continue",
			rationale: "Close time zones.",
			fellBack: false,
		};
		const other: Event = { ...interest, rationale: "Something else." };
		const facts = factsFor([exchange, interest, other]);
		expect(facts.get(interest)).toEqual([
			"Facts about you and p9 (computed by code):\n- Time zones: 2 hours apart.",
		]);
		expect(facts.has(other)).toBe(false);
	});
	it("says what code decided: rankings, drops, exclusions, a hunch's evidence, fallbacks", () => {
		expect(
			codeNotes({
				type: "offers",
				agent: "a",
				to: ["j"],
				places: 2,
				fellBack: false,
				ranked: ["j", "k"],
				dropped: [
					{
						id: "k",
						reason: "the team would pass its size limit of 2",
					},
				],
				excluded: [{ id: "x", reason: "already on a team" }],
			}),
		).toEqual([
			"Its model chose j, k",
			"Code dropped k: the team would pass its size limit of 2",
			"Not considered x: already on a team",
		]);
		expect(
			codeNotes({
				type: "hunch",
				agent: "a",
				other: "b",
				steer: "neutral",
				riskArea: null,
				fellBack: false,
				unfounded: true,
			}),
		).toEqual(["Cited no note, so code made the steer neutral"]);
		expect(
			codeNotes({
				type: "lock",
				agent: "a",
				team: "t",
				ask: 1,
				confident: false,
				fellBack: true,
			}),
		).toEqual(["No valid answer came back; code used the safe default"]);
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
	it("describes shared skills, availability, and preferences in words", () => {
		const share = (level: 1 | 2, shared: object) =>
			describeMessage({
				kind: "share",
				from: "p1",
				to: "p2",
				level,
				shared,
			} as Parameters<typeof describeMessage>[0]);
		expect(
			share(1, {
				interests: ["climate", "education"],
				availability: { hoursPerWeek: 12, utcOffset: -5 },
			}),
		).toBe(
			"shared level 1: interests climate, education · availability 12 h/week, UTC−5",
		);
		expect(
			share(2, {
				skills: [
					{ name: "backend", level: "expert" },
					{ name: "design", level: "beginner" },
				],
				preferences: {
					minTeamSize: 2,
					maxTeamSize: 3,
					preferredRoles: ["backend"],
				},
			}),
		).toBe(
			"shared level 2: skills backend (expert), design (beginner) · preferences team of 2–3, prefers backend",
		);
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
	it("keeps the reasoning behind an answer to a counter, whose id the engine derives", () => {
		const sent = (message: object) => ({
			type: "bus",
			event: { seq: 1, time: "t", type: "sent", message },
		});
		const decision = (
			agent: string,
			proposalId: string,
			d: string,
			rationale: string,
		) => ({
			type: "decision",
			agent,
			proposalId,
			decision: { decision: d },
			rationale,
			gateBlocks: 0,
			fellBack: false,
		});
		const events = parseLog(
			[
				sent({
					id: "r1-b-a",
					from: "b",
					to: "a",
					pitch: "A soccer replay app.",
					rolesNeeded: ["mobile"],
				}),
				sent({
					proposalId: "r1-b-a",
					from: "a",
					to: "b",
					decision: "counter",
					pitch: "A press conference sim.",
					rolesNeeded: ["ml"],
				}),
				decision("a", "r1-b-a", "counter", "My own idea fits better."),
				sent({
					proposalId: "r1-b-a.c",
					from: "b",
					to: "a",
					decision: "accept",
				}),
				decision("b", "r1-b-a.c", "accept", "It uses my ML."),
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		expect(
			pairEvents(events, "a", "b").filter((e) => e.type === "decision"),
		).toHaveLength(2);
		const { versions } = ideaVersions(events, "a", "b");
		expect(
			versions.map((v) => [v.how, v.status, v.why, v.answerWhy]),
		).toEqual([
			["proposal", "countered", undefined, "My own idea fits better."],
			[
				"counter",
				"accepted",
				"My own idea fits better.",
				"It uses my ML.",
			],
		]);
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
	it("tells a team's story: its idea with each side's reasoning, then offers, answers, and re-checks", () => {
		const sent = (message: object) => ({
			type: "bus",
			event: { seq: 1, time: "t", type: "sent", message },
		});
		const team = {
			id: "team-o",
			members: ["o", "m"],
			project: { title: "New project", description: "A tutor." },
			rolesNeeded: ["devops"],
			status: "committed",
		};
		const events = parseLog(
			[
				sent({
					id: "r1",
					from: "o",
					to: "m",
					pitch: "A study app.",
					rolesNeeded: ["design"],
				}),
				sent({
					proposalId: "r1",
					from: "m",
					to: "o",
					decision: "accept",
				}),
				{
					type: "decision",
					agent: "m",
					proposalId: "r1",
					decision: { decision: "accept" },
					rationale: "Fits my skills.",
					gateBlocks: 0,
					fellBack: false,
				},
				sent({
					kind: "interest",
					from: "o",
					to: "m",
					level: 1,
					interest: "continue",
				}),
				{
					type: "interest",
					agent: "o",
					other: "m",
					level: 1,
					interest: "continue",
					revision: { pitch: "A tutor.", rolesNeeded: ["devops"] },
					rationale: "Use their devops.",
					fellBack: false,
				},
				sent({
					kind: "revision",
					from: "o",
					to: "m",
					level: 1,
					pitch: "A tutor.",
					rolesNeeded: ["devops"],
				}),
				sent({
					kind: "revisionAnswer",
					from: "m",
					to: "o",
					adopt: true,
				}),
				{
					type: "revisionAnswer",
					agent: "m",
					other: "o",
					adopt: true,
					rationale: "Better for me.",
					fellBack: false,
				},
				{
					type: "offers",
					agent: "o",
					to: ["m"],
					places: 3,
					fellBack: false,
				},
				{
					type: "commitment",
					agent: "o",
					offers: ["k"],
					chose: null,
					busy: true,
					rationale: "Leading suits them.",
					fellBack: false,
				},
				sent({
					kind: "offer",
					from: "o",
					to: "m",
					team: "team-o",
					pitch: "A tutor.",
					rolesNeeded: ["devops"],
				}),
				{
					type: "commitment",
					agent: "m",
					offers: ["o"],
					chose: "o",
					rationale: "Best team.",
					fellBack: false,
				},
				sent({
					kind: "answer",
					from: "m",
					to: "o",
					team: "team-o",
					answer: "commit",
				}),
				{ type: "team", team },
			]
				.map((e) => JSON.stringify(e))
				.join("\n"),
		);
		const story = teamStory(events, team as never);
		expect(story.owner).toBe("o");
		expect(story.founder).toBe("m");
		expect(
			story.idea.versions.map((v) => [
				v.how,
				v.status,
				v.why,
				v.answerWhy,
			]),
		).toEqual([
			["proposal", "accepted", undefined, "Fits my skills."],
			["revision", "adopted", "Use their devops.", "Better for me."],
		]);
		// The offer repeated the adopted revision, so it's a step on that version, not a version of its own.
		expect(story.idea.versions[1]!.offers).toEqual([
			{
				from: "o",
				to: "m",
				status: "committed",
				why: undefined,
				answerWhy: "Best team.",
			},
		]);
		expect(story.idea.agreed).toBe(1);
		expect(story.steps).toEqual([
			{ who: "o", what: "offered", others: ["m"], why: undefined },
			{
				who: "o",
				what: "led",
				others: ["k"],
				why: "Leading suits them.",
			},
			{ who: "m", what: "joined", others: ["o"], why: "Best team." },
		]);
		// Before the offers, the story stops at the adopted revision, with no steps yet.
		const earlier = teamStory(events.slice(0, 8), team as never);
		expect(earlier.idea.agreed).toBe(1);
		expect(earlier.steps).toEqual([]);
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

describe("scope repair replay", () => {
	const before: Extract<Event, { type: "team" }>["team"] = {
		id: "team-a",
		members: ["a", "b"],
		project: {
			title: "Tutor",
			description: "Lessons with server sessions.",
		},
		rolesNeeded: ["ml", "backend"],
		status: "tentative",
	};
	const revision = {
		title: "Local Tutor",
		pitch: "Lessons locally.",
		problem: "Practice lessons.",
		build: "Bundled exercises and local session state.",
		rolesNeeded: ["ml"],
		roleWork: { ml: "classify exercises" },
	};
	const proposal: Event = {
		type: "repair",
		team: "team-a",
		agent: "a",
		step: "proposal",
		revision,
		removedWork: [{ role: "backend", change: "Use local state." }],
		rationale: "Simpler",
		fellBack: false,
	};
	it("shows the adopted scope and card as the team's final version", () => {
		const after = {
			...before,
			project: { title: revision.title, description: revision.pitch },
			rolesNeeded: revision.rolesNeeded,
			build: revision.build,
		};
		const events: Event[] = [
			{ type: "team", team: before },
			proposal,
			{
				type: "repair",
				team: "team-a",
				agent: "a",
				step: "result",
				applied: true,
				reason: "unanimous",
				fellBack: false,
			},
			{ type: "team", team: after },
		];
		const result = ideaVersions(events, "a", "b");
		expect(result.agreed).toBe(0);
		expect(result.versions[0]).toMatchObject({
			title: "Local Tutor",
			status: "adopted",
			card: { build: revision.build },
			rolesNeeded: ["ml"],
		});
		expect(describeEvent(events[2]!)).toContain("adopted unanimously");
		expect(project(events).teams).toHaveLength(1);
		expect(project(events).teams[0]?.project.title).toBe("Local Tutor");
	});
	it("never treats a rejected repair as an agreed version", () => {
		const result = ideaVersions(
			[
				{ type: "team", team: before },
				proposal,
				{
					type: "repair",
					team: "team-a",
					agent: "a",
					step: "result",
					applied: false,
					reason: "rejected",
					fellBack: false,
				},
			],
			"a",
			"b",
		);
		expect(result.versions).toEqual([]);
		expect(result.agreed).toBeUndefined();
	});
});
