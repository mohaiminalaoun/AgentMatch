import { describe, expect, it } from "vitest";
import {
	ideaVersions,
	parseLog,
	teamStory,
	type Event,
	type IdeaVersion,
} from "../../src/ui/web/replay.js";
import {
	DIFF_CAP,
	ideaTimeline,
	pitchChange,
	roleChanges,
	stepLabel,
	teamSection,
	type DiffSpan,
} from "../../src/ui/web/timeline.js";

const sent = (message: object) => ({
	type: "bus",
	event: { seq: 1, time: "t", type: "sent", message },
});
const log = (lines: object[]): Event[] =>
	parseLog(lines.map((e) => JSON.stringify(e)).join("\n"));
const join = (diff: DiffSpan[], keep: DiffSpan["op"]) =>
	diff
		.filter((d) => d.op === "same" || d.op === keep)
		.map((d) => d.text)
		.join("");
const version = (over: Partial<IdeaVersion>): IdeaVersion => ({
	how: "revision",
	author: "a",
	from: "a",
	to: "b",
	pitch: "A recipe app.",
	rolesNeeded: ["design"],
	card: {},
	status: "open",
	...over,
});
const proposal = (pitch: string, roles: string[], title?: string) =>
	sent({
		id: "r1",
		from: "o",
		to: "m",
		pitch,
		rolesNeeded: roles,
		...(title && { title }),
	});
const counter = (pitch: string, roles: string[], title?: string) =>
	sent({
		proposalId: "r1",
		from: "m",
		to: "o",
		decision: "counter",
		pitch,
		rolesNeeded: roles,
		...(title && { title }),
	});
const accept = (from: string, to: string) =>
	sent({ proposalId: "r1", from, to, decision: "accept" });
const revision = (
	from: string,
	to: string,
	pitch: string,
	roles: string[],
	title?: string,
) =>
	sent({
		kind: "revision",
		from,
		to,
		level: 1,
		pitch,
		rolesNeeded: roles,
		...(title && { title }),
	});
const revisionAnswer = (from: string, to: string, adopt: boolean) =>
	sent({ kind: "revisionAnswer", from, to, adopt });
const offer = (to: string, pitch: string, roles: string[]) =>
	sent({
		kind: "offer",
		from: "o",
		to,
		team: "team-o",
		pitch,
		rolesNeeded: roles,
	});
const answer = (from: string, ans: string) =>
	sent({ kind: "answer", from, to: "o", team: "team-o", answer: ans });

describe("pitch changes", () => {
	it("finds no change in identical pitches", () => {
		expect(pitchChange("A recipe app.", "A recipe app.")).toEqual({
			mode: "none",
		});
	});
	it("marks words inserted in the middle, and rebuilds both pitches from the spans", () => {
		const before =
			"Upload app screen recordings, then review timestamped suspects with frames in a web app.";
		const after =
			"Upload app screen recordings, then review timestamped suspects with a trained ML scorer and frames in a web app.";
		const change = pitchChange(before, after);
		expect(change.mode).toBe("inline");
		if (change.mode !== "inline") return;
		const added = change.diff.filter((d) => d.op === "added");
		expect(added.map((d) => d.text.trim())).toEqual([
			"a trained ML scorer and",
		]);
		expect(change.diff.some((d) => d.op === "removed")).toBe(false);
		expect(join(change.diff, "added")).toBe(after);
		expect(join(change.diff, "removed")).toBe(before);
	});
	it("strikes deleted words", () => {
		const change = pitchChange(
			"A meal planner for busy families with kids.",
			"A meal planner for families with kids.",
		);
		expect(change.mode).toBe("inline");
		if (change.mode !== "inline") return;
		expect(
			change.diff
				.filter((d) => d.op !== "same")
				.map((d) => [d.op, d.text.trim()]),
		).toEqual([["removed", "busy"]]);
	});
	it("shows a small replacement as one word out and one in", () => {
		const before =
			"A meal planner that suggests weekly recipes for families.";
		const after =
			"A meal planner that suggests daily recipes for families.";
		const change = pitchChange(before, after);
		expect(change.mode).toBe("inline");
		if (change.mode !== "inline") return;
		expect(
			change.diff
				.filter((d) => d.op !== "same")
				.map((d) => [d.op, d.text]),
		).toEqual([
			["removed", "weekly"],
			["added", "daily"],
		]);
		expect(join(change.diff, "added")).toBe(after);
		expect(join(change.diff, "removed")).toBe(before);
	});
	it("shows a substantially rewritten pitch as before and after", () => {
		const before = "Upload app screen recordings to detect visual UI bugs.";
		const after =
			"Type a plain-language requirement, get a test plan, run it in a real browser.";
		expect(pitchChange(before, after)).toEqual({
			mode: "rewrite",
			before,
			after,
		});
	});
	it("treats an empty pitch before as everything added", () => {
		expect(pitchChange("", "A recipe app.")).toEqual({
			mode: "inline",
			diff: [{ text: "A recipe app.", op: "added" }],
		});
	});
	it("compares pitches too long to diff as a rewrite", () => {
		const words = (n: number, w: string) =>
			Array.from({ length: n }, () => w).join(" ");
		const side = Math.ceil(Math.sqrt(DIFF_CAP)) + 1;
		const before = words(side, "a");
		const after = `${words(side, "a")} b`;
		expect(pitchChange(before, after).mode).toBe("rewrite");
	});
});

describe("role changes", () => {
	it("marks added roles in the new order, then dropped ones", () => {
		expect(
			roleChanges(["backend", "design", "data"], ["ml", "backend"]),
		).toEqual([
			{ role: "ml", change: "added" },
			{ role: "backend", change: "kept" },
			{ role: "design", change: "dropped" },
			{ role: "data", change: "dropped" },
		]);
	});
	it("keeps every role with no version before", () => {
		expect(roleChanges(undefined, ["design", "ml"])).toEqual([
			{ role: "design", change: "kept" },
			{ role: "ml", change: "kept" },
		]);
	});
	it("counts a reorder alone as no change", () => {
		expect(
			roleChanges(["design", "ml"], ["ml", "design"]).every(
				(r) => r.change === "kept",
			),
		).toBe(true);
	});
});

describe("step labels", () => {
	const v1 = version({ title: "UI Bug Finder" });
	it("names the first version by its title, or v1", () => {
		expect(stepLabel(v1, undefined)).toBe("UI Bug Finder");
		expect(stepLabel(version({}), undefined)).toBe("v1");
	});
	it("names a renamed version by its new title", () => {
		expect(stepLabel(version({ title: "Tested" }), v1)).toBe("Tested");
	});
	it("names a version by the roles it added and dropped", () => {
		expect(
			stepLabel(
				version({ rolesNeeded: ["ml", "devops"] }),
				v1,
				"UI Bug Finder",
			),
		).toBe("+ML +DevOps −Design");
	});
	it("tells a reworded pitch from a rewritten one", () => {
		expect(
			stepLabel(
				version({ pitch: "A recipe app for families." }),
				v1,
				"UI Bug Finder",
			),
		).toBe("Pitch reworded");
		expect(
			stepLabel(
				version({
					pitch: "Track workouts with friends and share streaks.",
				}),
				v1,
				"UI Bug Finder",
			),
		).toBe("Pitch rewritten");
	});
	it("names an edited card, else nothing changed", () => {
		expect(
			stepLabel(
				version({ card: { problem: "Cooking is hard." } }),
				v1,
				"UI Bug Finder",
			),
		).toBe("Card edited");
		expect(stepLabel(version({}), v1, "UI Bug Finder")).toBe(
			"Same as before",
		);
	});
});

describe("idea timeline", () => {
	it("lists versions in the order sent, with exactly one chosen: an offer that changed the idea", () => {
		const events = log([
			proposal("A study app.", ["design"], "Study"),
			counter("A study app with quizzes.", ["design", "ml"]),
			accept("o", "m"),
			revision("o", "m", "A study app with spaced quizzes.", ["ml"]),
			revisionAnswer("m", "o", true),
			offer("m", "A tutor that plans study sessions.", ["ml"]),
			answer("m", "commit"),
		]);
		const t = ideaTimeline(ideaVersions(events, "o", "m"));
		expect(t.nodes.map((n) => [n.n, n.v.how, n.state])).toEqual([
			[1, "proposal", "step"],
			[2, "counter", "superseded"],
			[3, "revision", "superseded"],
			[4, "offer", "chosen"],
		]);
		expect(t.nodes[1]!.replacedBy).toBe(3);
		expect(t.nodes[2]!.replacedBy).toBe(4);
		expect(t.nodes.filter((n) => n.state === "chosen")).toHaveLength(1);
		expect(t.chosen).toBe(3);
		expect(t.badge).toBe("the team's project");
		expect(t.nodes.map((n) => n.label)).toEqual([
			"Study",
			"+ML",
			"−Design",
			"Pitch rewritten",
		]);
	});
	it("keeps the agreed version as chosen when a later revision is kept", () => {
		const events = log([
			proposal("A recipe app.", ["design"], "Recipes"),
			counter("A meal planner.", ["design", "backend"], "Meals"),
			accept("o", "m"),
			revision(
				"o",
				"m",
				"A family meal planner.",
				["backend"],
				"Family Meals",
			),
			revisionAnswer("m", "o", false),
		]);
		const t = ideaTimeline(ideaVersions(events, "o", "m"));
		expect(t.chosen).toBe(1);
		expect(t.latest).toBe(2);
		expect(t.laterNotAdopted).toBe(1);
		expect(t.nodes.map((n) => n.state)).toEqual([
			"step",
			"chosen",
			"not-adopted",
		]);
		// The header names the chosen version, not the latest.
		expect(t.title).toBe("Meals");
		expect(t.badge).toBe("agreed now");
	});
	it("keeps the agreed version as chosen when a later revision is still open", () => {
		const events = log([
			proposal("A recipe app.", ["design"], "Recipes"),
			accept("m", "o"),
			revision("m", "o", "A recipe app with a shopping list.", [
				"design",
				"backend",
			]),
		]);
		const t = ideaTimeline(ideaVersions(events, "o", "m"));
		expect(t.chosen).toBe(0);
		expect(t.latest).toBe(1);
		expect(t.laterNotAdopted).toBe(1);
		expect(t.nodes.map((n) => n.state)).toEqual(["chosen", "not-adopted"]);
		expect(t.title).toBe("Recipes");
	});
	it("treats a new proposal in the same pair as a new idea, not an edit, and tags versions not adopted", () => {
		const events = log([
			proposal(
				"Snap a houseplant to see if it is toxic to pets.",
				["backend"],
				"Plant Checker",
			),
			sent({ proposalId: "r1", from: "m", to: "o", decision: "decline" }),
			sent({
				id: "r2",
				from: "m",
				to: "o",
				pitch: "Let's come up with a project together.",
				rolesNeeded: ["frontend"],
			}),
			sent({ proposalId: "r2", from: "o", to: "m", decision: "accept" }),
			revision(
				"m",
				"o",
				"A soccer replay from a phone clip.",
				["mobile"],
				"TopDown",
			),
			revisionAnswer("o", "m", false),
			revision("o", "m", "A walking quest game.", ["ml"], "Move Quest"),
			revisionAnswer("m", "o", true),
		]);
		const t = ideaTimeline(ideaVersions(events, "o", "m"));
		expect(t.nodes.map((n) => [n.label, n.state])).toEqual([
			["Plant Checker", "not-adopted"],
			["New idea", "superseded"],
			["TopDown", "not-adopted"],
			["Move Quest", "chosen"],
		]);
		const fresh = t.nodes[1]!;
		expect(fresh.before).toBeUndefined();
		expect(fresh.pitch).toEqual({ mode: "none" });
		expect(fresh.roles).toEqual([{ role: "frontend", change: "kept" }]);
		// The new idea doesn't carry the earlier idea's name.
		expect(fresh.title).toBeUndefined();
		expect(t.nodes[1]!.replacedBy).toBe(4);
		// Versions before the chosen one don't count as later ones.
		expect(t.laterNotAdopted).toBe(0);
	});
	it("follows the team's project over the version agreed last", () => {
		const events = log([
			proposal("A recipe app.", ["design"]),
			counter("A meal planner.", ["design", "backend"]),
			accept("o", "m"),
		]);
		const idea = ideaVersions(events, "o", "m");
		expect(idea.agreed).toBe(1);
		const team = {
			id: "team-o",
			members: ["o", "m"],
			project: { title: "Recipes", description: "A recipe app." },
			rolesNeeded: ["design"],
			status: "committed" as const,
		};
		const t = ideaTimeline(idea, team);
		expect(t.chosen).toBe(0);
		expect(t.nodes.map((n) => n.state)).toEqual(["chosen", "not-adopted"]);
		expect(t.title).toBe("Recipes");
	});
	it("attaches an offer that repeats the agreed version to it, adding no version", () => {
		const events = log([
			proposal("A recipe app.", ["design"]),
			accept("m", "o"),
			offer("m", "A recipe app.", ["design"]),
			answer("m", "commit"),
		]);
		const t = ideaTimeline(ideaVersions(events, "o", "m"));
		expect(t.nodes).toHaveLength(1);
		expect(t.nodes[0]!.offers).toEqual([
			expect.objectContaining({
				from: "o",
				to: "m",
				status: "committed",
			}),
		]);
		expect(t.badge).toBe("never changed");
		expect(t.nodes[0]!.state).toBe("chosen");
	});
	it("diffs each version against the one sent just before it", () => {
		const events = log([
			proposal("A recipe app.", ["design"]),
			counter("A recipe app for families.", ["design"]),
		]);
		const t = ideaTimeline(ideaVersions(events, "o", "m"));
		expect(t.nodes[0]!.pitch).toEqual({ mode: "none" });
		expect(t.nodes[1]!.pitch.mode).toBe("inline");
		expect(t.chosen).toBeUndefined();
		expect(t.badge).toBe("still on the table");
	});
});

describe("team section", () => {
	const team = (roles?: Record<string, string>) => ({
		id: "team-o",
		members: ["o", "m", "k"],
		project: { title: "Recipes", description: "A recipe app." },
		rolesNeeded: ["design", "backend"],
		status: "committed" as const,
		...(roles && { roles }),
	});
	const events = (t: ReturnType<typeof team>) =>
		log([
			proposal("A recipe app.", ["design"]),
			accept("m", "o"),
			sent({
				id: "r2",
				from: "o",
				to: "k",
				pitch: "A pantry tracker.",
				rolesNeeded: ["backend"],
			}),
			sent({ proposalId: "r2", from: "k", to: "o", decision: "accept" }),
			{
				type: "offers",
				agent: "o",
				to: ["m"],
				places: 3,
				rationale: "m fits design.",
				fellBack: false,
			},
			offer("m", "A recipe app.", ["design"]),
			{
				type: "commitment",
				agent: "m",
				offers: ["o"],
				chose: null,
				rationale: "Not sure yet.",
				fellBack: false,
			},
			answer("m", "decline"),
			{
				type: "offers",
				agent: "o",
				to: ["m", "k"],
				places: 3,
				rationale: "Try again with both.",
				fellBack: false,
			},
			offer("m", "A recipe app.", ["design"]),
			offer("k", "A recipe app.", ["design"]),
			{
				type: "commitment",
				agent: "m",
				offers: ["o"],
				chose: "o",
				rationale: "Good now.",
				fellBack: false,
			},
			{
				type: "commitment",
				agent: "k",
				offers: ["o"],
				chose: "o",
				rationale: "Fine.",
				fellBack: false,
			},
			answer("m", "commit"),
			answer("k", "commit"),
			{ type: "team", team: t },
		]);
	it("lists steps in event order, ties founder steps to the version offered, and keeps reasoning verbatim", () => {
		const t = team({ m: "design", k: "backend" });
		const evs = events(t);
		const story = teamStory(evs, t as never);
		const timeline = ideaTimeline(story.idea, t as never);
		const section = teamSection(evs, story, t as never, timeline);
		expect(
			section.steps.map((s) => [s.who, s.what, s.version, s.why]),
		).toEqual([
			["o", "offered", 1, "m fits design."],
			["m", "declined", 1, "Not sure yet."],
			["o", "offered", 1, "Try again with both."],
			["m", "joined", 1, "Good now."],
			["k", "joined", undefined, "Fine."],
		]);
		// Both offers to the founder stay on the version they carried, in the idea timeline too.
		expect(timeline.nodes).toHaveLength(1);
		expect(timeline.nodes[0]!.offers.map((o) => o.status)).toEqual([
			"declined",
			"committed",
		]);
		expect(
			section.members.map((m) => [m.id, m.owner, m.role, m.origin]),
		).toEqual([
			["o", true, undefined, { kind: "owner" }],
			["m", false, "design", { kind: "founder", versions: 1 }],
			[
				"k",
				false,
				"backend",
				{
					kind: "joiner",
					agreed: { title: undefined, pitch: "A pantry tracker." },
				},
			],
		]);
		expect(section.rolesCovered).toBe(true);
	});
	it("says when roles are still open, and nothing for logs without roles", () => {
		const open = team({ m: "design" });
		const evsOpen = events(open);
		const storyOpen = teamStory(evsOpen, open as never);
		expect(
			teamSection(
				evsOpen,
				storyOpen,
				open as never,
				ideaTimeline(storyOpen.idea),
			).rolesCovered,
		).toBe(false);
		const old = team();
		const evsOld = events(old);
		const storyOld = teamStory(evsOld, old as never);
		expect(
			teamSection(
				evsOld,
				storyOld,
				old as never,
				ideaTimeline(storyOld.idea),
			).rolesCovered,
		).toBeUndefined();
	});
});
