import {
	ideaVersions,
	pairEvents,
	type Event,
	type IdeaVersion,
	type OfferStep,
	type teamStory,
	type TeamStep,
} from "./replay.js";

// The Teams tab's timeline of how a team's idea evolved, and how the team formed around it, worked out from
// the replay by code alone: no model calls, and every private rationale passed through verbatim.

type Team = Extract<Event, { type: "team" }>["team"];
type Idea = ReturnType<typeof ideaVersions>;
type Story = ReturnType<typeof teamStory>;

// "a03" → "03", "p-c41e" → "c41e": an agent's id as the step bar shows it.
export const shortId = (id: string) =>
	id.replace(/^a0?/, "").replace(/^p-?/, "").padStart(2, "0");

const ROLE_NAMES: Record<string, string> = { ml: "ML", devops: "DevOps" };
// A role as people write it: "ml" → "ML", "frontend" → "Frontend".
export const roleName = (role: string) =>
	ROLE_NAMES[role] ?? role.charAt(0).toUpperCase() + role.slice(1);

export type DiffSpan = { text: string; op: "same" | "added" | "removed" };
export type PitchChange =
	| { mode: "none" }
	| { mode: "inline"; diff: DiffSpan[] }
	| { mode: "rewrite"; before: string; after: string };

// Below this share of words kept, a pitch counts as rewritten and shows as before and after, not a word diff.
export const REWRITE_BELOW = 0.5;
// Pitches whose word counts multiply past this are compared as a rewrite, without a diff.
export const DIFF_CAP = 40_000;

// Words, runs of whitespace, and single punctuation marks, so joining tokens gives back the text exactly and
// a word that gains a comma still counts as kept.
const tokens = (text: string) =>
	text.match(/\s+|[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}'’-]/gu) ?? [];
const isWord = (token: string) => !/^\s+$/.test(token);

// How a pitch changed from `before` to `after`: not at all; a word diff, where joining the same and added
// spans gives `after` and joining the same and removed spans gives `before`; or, when most words changed, the
// two pitches side by side.
export function pitchChange(before: string, after: string): PitchChange {
	if (before === after) return { mode: "none" };
	const a = tokens(before);
	const b = tokens(after);
	if (a.length * b.length > DIFF_CAP)
		return { mode: "rewrite", before, after };
	// Longest common subsequence of tokens, filled from the end.
	const lcs = Array.from({ length: a.length + 1 }, () =>
		new Array<number>(b.length + 1).fill(0),
	);
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			lcs[i]![j] =
				a[i] === b[j]
					? lcs[i + 1]![j + 1]! + 1
					: Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
	const diff: DiffSpan[] = [];
	const push = (text: string, op: DiffSpan["op"]) => {
		const last = diff.at(-1);
		if (last?.op === op) last.text += text;
		else diff.push({ text, op });
	};
	// Walk the table, taking removals before additions so a replaced word reads old then new.
	let kept = 0;
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			if (isWord(a[i]!)) kept++;
			push(a[i]!, "same");
			i++;
			j++;
		} else if (
			i < a.length &&
			(j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)
		) {
			push(a[i]!, "removed");
			i++;
		} else {
			push(b[j]!, "added");
			j++;
		}
	}
	const words = Math.max(a.filter(isWord).length, b.filter(isWord).length);
	if (a.length > 0 && b.length > 0 && kept / words < REWRITE_BELOW)
		return { mode: "rewrite", before, after };
	return { mode: "inline", diff };
}

// Whether a changed span needs a space after it when shown: a removed word right next to the word replacing it
// (or the other way round) would otherwise run together on screen and when copied. Not before punctuation,
// which attaches to the word before it.
export function needsGap(span: DiffSpan, next: DiffSpan | undefined): boolean {
	return (
		span.op !== "same" &&
		next !== undefined &&
		next.op !== "same" &&
		!/\s$/.test(span.text) &&
		!/^[\s.,;:!?)\]]/.test(next.text)
	);
}

export type RoleChange = { role: string; change: "kept" | "added" | "dropped" };
// Each role a version needs, marked added if `before` didn't need it, then the roles `before` needed that it
// dropped. With no `before`, every role is kept; a reorder alone changes nothing.
export function roleChanges(
	before: readonly string[] | undefined,
	after: readonly string[],
): RoleChange[] {
	if (!before) return after.map((role) => ({ role, change: "kept" }));
	return [
		...after.map((role): RoleChange => ({
			role,
			change: before.includes(role) ? "kept" : "added",
		})),
		...before
			.filter((role) => !after.includes(role))
			.map((role): RoleChange => ({ role, change: "dropped" })),
	];
}

const verbs: Record<IdeaVersion["how"], string> = {
	proposal: "started",
	join: "asked to join",
	counter: "countered",
	revision: "reshaped",
	offer: "offered",
};
// What the sender of a version did, for the step bar: "countered", "reshaped".
export const stepVerb = (v: IdeaVersion) =>
	v.scopeRepair ? "repaired scope" : verbs[v.how];

// Whether a version is a new idea rather than a change to the one before: a proposal or join request, which
// starts afresh even when the pair had discussed another idea earlier.
export const isNewIdea = (v: IdeaVersion) =>
	v.how === "proposal" || v.how === "join";

// A short label for a version on the step bar, from what changed since `before`: the first version's title (or
// "v1"); a new idea's title (or "New idea"); a new title; the roles added and dropped; a reworded or rewritten pitch; an edited card; or nothing.
// `prevTitle` is the project's name before this version, when the previous version didn't restate it.
export function stepLabel(
	v: IdeaVersion,
	before: IdeaVersion | undefined,
	prevTitle: string | undefined = before?.title,
): string {
	if (!before) return v.title ?? "v1";
	if (isNewIdea(v)) return v.title ?? "New idea";
	if (v.title && v.title !== prevTitle) return v.title;
	const roles = roleChanges(before.rolesNeeded, v.rolesNeeded).filter(
		(r) => r.change !== "kept",
	);
	if (roles.length > 0)
		return roles
			.map(
				(r) => `${r.change === "added" ? "+" : "−"}${roleName(r.role)}`,
			)
			.join(" ");
	const pitch = pitchChange(before.pitch, v.pitch);
	if (pitch.mode === "rewrite") return "Pitch rewritten";
	if (pitch.mode === "inline") return "Pitch reworded";
	if (JSON.stringify(before.card) !== JSON.stringify(v.card))
		return "Card edited";
	return "Same as before";
}

// Where a version stands: the one the team builds; an agreed version a later one replaced; a version that wasn't
// adopted (declined, kept, or, after the chosen one, still open); or a step on the way.
export type NodeState = "chosen" | "superseded" | "not-adopted" | "step";
export type TimelineNode = {
	// The version's number, from 1.
	n: number;
	v: IdeaVersion;
	// The version this one changed, or undefined for a new idea, which changes nothing.
	before: IdeaVersion | undefined;
	// The project's name as of this version, and whether this version renamed it.
	title: string | undefined;
	renamed: boolean;
	label: string;
	pitch: PitchChange;
	roles: RoleChange[];
	// Offers that carried this version unchanged, and their answers.
	offers: OfferStep[];
	state: NodeState;
	// For a superseded version, the number of the version that replaced it.
	replacedBy?: number | undefined;
};
export type IdeaTimeline = {
	nodes: TimelineNode[];
	// The index of the version the team builds, if one is settled, and of the latest version.
	chosen: number | undefined;
	latest: number;
	// How many versions came after the chosen one.
	laterNotAdopted: number;
	badge:
		| "never changed"
		| "the team's project"
		| "agreed now"
		| "still on the table";
	// The chosen version's name, else the latest's, else the team's.
	title: string | undefined;
};

const settled = new Set<IdeaVersion["status"]>([
	"accepted",
	"adopted",
	"committed",
]);
// The version the team builds: given a team, the version whose pitch it committed to (the agreed one if
// several match, else the newest settled, else the newest); otherwise the version agreed now.
function chosenIndex(idea: Idea, team: Team | undefined): number | undefined {
	if (team) {
		const matches = idea.versions
			.map((v, i) => (v.pitch === team.project.description ? i : -1))
			.filter((i) => i >= 0);
		if (idea.agreed !== undefined && matches.includes(idea.agreed))
			return idea.agreed;
		const good = matches.filter((i) => {
			const v = idea.versions[i]!;
			return (
				settled.has(v.status) ||
				(v.offers ?? []).some((o) => o.status === "committed")
			);
		});
		const pick = good.at(-1) ?? matches.at(-1);
		if (pick !== undefined) return pick;
	}
	return idea.agreed;
}

// Every version of the idea in the order it was sent, each with what changed from the one before and where it
// stands, plus the version the team chose, which drives the header even when later versions weren't adopted.
export function ideaTimeline(idea: Idea, team?: Team): IdeaTimeline {
	const { versions } = idea;
	const chosen = chosenIndex(idea, team);
	const titles: (string | undefined)[] = [];
	// A new idea doesn't inherit the name of the idea discussed before it.
	versions.forEach((v, i) =>
		titles.push(isNewIdea(v) ? v.title : (v.title ?? titles[i - 1])),
	);
	const nodes = versions.map((v, i): TimelineNode => {
		const before = isNewIdea(v) ? undefined : versions[i - 1];
		const prevTitle = titles[i - 1];
		let state: NodeState = "step";
		let replacedBy: number | undefined;
		if (i === chosen) state = "chosen";
		else if (
			(chosen !== undefined && i > chosen) ||
			v.status === "kept" ||
			v.status === "declined"
		)
			state = "not-adopted";
		else if (settled.has(v.status)) {
			state = "superseded";
			const next = versions.findIndex(
				(w, k) => k > i && (k === chosen || settled.has(w.status)),
			);
			if (next >= 0) replacedBy = next + 1;
		}
		return {
			n: i + 1,
			v,
			before,
			title: titles[i],
			renamed: Boolean(v.title && before && v.title !== prevTitle),
			label: stepLabel(v, versions[i - 1], prevTitle),
			pitch: before
				? pitchChange(before.pitch, v.pitch)
				: { mode: "none" },
			roles: roleChanges(before?.rolesNeeded, v.rolesNeeded),
			offers: v.offers ?? [],
			state,
			...(replacedBy !== undefined && { replacedBy }),
		};
	});
	const latest = versions.length - 1;
	const chosenVersion = chosen === undefined ? undefined : versions[chosen];
	const joined =
		chosenVersion !== undefined &&
		(chosenVersion.status === "committed" ||
			(chosenVersion.offers ?? []).some((o) => o.status === "committed"));
	return {
		nodes,
		chosen,
		latest,
		laterNotAdopted: chosen === undefined ? 0 : latest - chosen,
		badge:
			versions.length === 1
				? "never changed"
				: chosen === undefined
					? "still on the table"
					: joined
						? "the team's project"
						: "agreed now",
		title: titles[chosen ?? latest] ?? team?.project.title,
	};
}

// A member of a team and how they came to it, as facts from the log.
export type TeamMember = {
	id: string;
	owner: boolean;
	// Whether the owner chose to lead this team over joining others.
	led: boolean;
	// The role they fill, when the log records it.
	role: string | undefined;
	origin:
		| { kind: "owner" }
		| { kind: "founder"; versions: number }
		| {
				kind: "joiner";
				// What their own conversation with the owner had agreed, when it was a different idea.
				agreed?: { title: string | undefined; pitch: string };
		  };
};
// A step toward the team, with the version of the idea it was about, when that's known for sure.
export type FormationStep = TeamStep & { version?: number | undefined };
export type TeamSection = {
	members: TeamMember[];
	steps: FormationStep[];
	// Whether someone fills every role the team needs; undefined in older logs, which don't record roles.
	rolesCovered: boolean | undefined;
};

// The version each offer from `owner` to `founder` carried, in the order they were sent, matched by content
// to the timeline: an offer that changed the idea is a version of its own; one that repeated a version is a
// step on it.
function offeredVersions(
	events: Event[],
	owner: string,
	founder: string,
	timeline: IdeaTimeline,
): (number | undefined)[] {
	const usedNodes = new Set<number>();
	const usedSteps = new Map<number, number>();
	const out: (number | undefined)[] = [];
	for (const e of pairEvents(events, owner, founder)) {
		if (e.type !== "bus" || e.event.type !== "sent") continue;
		const m = e.event.message;
		if (!("kind" in m) || m.kind !== "offer" || m.from !== owner) continue;
		const sameAs = (v: IdeaVersion) =>
			v.pitch === m.pitch &&
			JSON.stringify(v.rolesNeeded) === JSON.stringify(m.rolesNeeded);
		const own = timeline.nodes.find(
			(node) =>
				node.v.how === "offer" &&
				node.v.from === owner &&
				!usedNodes.has(node.n) &&
				sameAs(node.v),
		);
		if (own) {
			usedNodes.add(own.n);
			out.push(own.n);
			continue;
		}
		const repeated = timeline.nodes.find(
			(node) =>
				sameAs(node.v) &&
				(usedSteps.get(node.n) ?? 0) <
					node.offers.filter((o) => o.to === founder).length,
		);
		if (repeated)
			usedSteps.set(repeated.n, (usedSteps.get(repeated.n) ?? 0) + 1);
		out.push(repeated?.n);
	}
	return out;
}

// How a team formed: its members, owner first, with how each came to it; every offer, answer, and re-check in
// order, each tied to the version it was about when the log says so for sure; and whether every role is filled.
// Steps keep their private reasoning verbatim.
export function teamSection(
	events: Event[],
	story: Story,
	team: Team,
	timeline: IdeaTimeline,
): TeamSection {
	const { owner, founder, steps, joiners } = story;
	const led = steps.some((s) => s.who === owner && s.what === "led");
	const members = team.members.map((id, i): TeamMember => {
		const joiner = joiners.find((j) => j.id === id);
		return {
			id,
			owner: i === 0,
			led: i === 0 && led,
			role: team.roles?.[id],
			origin:
				i === 0
					? { kind: "owner" }
					: id === founder
						? { kind: "founder", versions: timeline.nodes.length }
						: {
								kind: "joiner",
								...(joiner && {
									agreed: {
										title: joiner.title,
										pitch: joiner.pitch,
									},
								}),
							},
		};
	});
	// Steps about the founder line up one to one with the offers the owner sent them; only when the counts
	// agree is each tied to its version, so no step is ever tied to the wrong one.
	const offered = founder
		? offeredVersions(events, owner, founder, timeline)
		: [];
	const toFounder = steps.filter(
		(s) =>
			s.who === owner &&
			s.what === "offered" &&
			founder &&
			s.others.includes(founder),
	);
	const fromFounder = steps.filter(
		(s) =>
			s.who === founder &&
			(s.what === "joined" || s.what === "declined" || s.what === "busy"),
	);
	const tag = new Map<TeamStep, number | undefined>();
	if (toFounder.length === offered.length)
		toFounder.forEach((s, k) => tag.set(s, offered[k]));
	if (fromFounder.length === offered.length)
		fromFounder.forEach((s, k) => tag.set(s, offered[k]));
	return {
		members,
		steps: steps.map((s) => {
			const version = tag.get(s);
			return version === undefined ? s : { ...s, version };
		}),
		rolesCovered: team.roles
			? team.rolesNeeded.every((r) =>
					Object.values(team.roles!).includes(r),
				)
			: undefined,
	};
}
