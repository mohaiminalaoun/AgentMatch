import { z } from "zod";
import type { AgentMessage } from "../../engine/agent.js";
import type { RunEvent } from "../../engine/events.js";

export type Event = RunEvent;
export type Person = {
	id: string;
	pitch: string;
	roles: string[];
	name?: string;
};
export const demoPeople: Person[] = [
	{
		id: "a01",
		pitch: "A calmer corner of the internet. A space to build healthy digital habits.",
		roles: ["frontend", "design"],
	},
	{
		id: "a02",
		pitch: "Make local food accessible. Connect surplus produce with neighborhood kitchens.",
		roles: ["backend", "product"],
	},
	{
		id: "a03",
		pitch: "Turn everyday climate choices into a collective impact.",
		roles: ["mobile", "design"],
	},
	{
		id: "a04",
		pitch: "A calmer corner of the internet. Thoughtful tools for more intentional days.",
		roles: ["backend", "product"],
	},
	{
		id: "a05",
		pitch: "Help independent creators find their first thousand true fans.",
		roles: ["frontend", "product"],
	},
	{
		id: "a06",
		pitch: "Bring neighborhood kitchens and local growers together.",
		roles: ["frontend", "design"],
	},
	{
		id: "a07",
		pitch: "Developer tools that make the small things feel effortless.",
		roles: ["backend", "devops"],
	},
	{
		id: "a08",
		pitch: "Make climate action a little more human, one habit at a time.",
		roles: ["data", "backend"],
	},
	{
		id: "a09",
		pitch: "Build a better creative routine for independent makers.",
		roles: ["design", "mobile"],
	},
	{
		id: "a10",
		pitch: "Looking for a thoughtful project with people who care.",
		roles: [],
	},
	{
		id: "a11",
		pitch: "A little less screen time. A little more life.",
		roles: ["mobile", "product"],
	},
	{
		id: "a12",
		pitch: "Help small teams ship with confidence.",
		roles: ["frontend", "devops"],
	},
];
export const demoEvents: Event[] = [];
for (const p of demoPeople)
	demoEvents.push({
		type: "listing",
		agent: p.id,
		pitch: p.pitch,
		rolesNeeded: p.roles,
		gateBlocks: 0,
		fellBack: false,
	});
demoEvents.push({
	type: "round",
	time: "2026-10-28T12:00:00Z",
	model: "Synthetic demo",
	agents: demoPeople.map((p) => p.id),
});
for (const [i, pair] of [
	["a01", "a04"],
	["a02", "a06"],
	["a03", "a08"],
	["a05", "a09"],
	["a07", "a12"],
	["a01", "a11"],
	["a04", "a10"],
].entries()) {
	const [a, b] = pair as [string, string];
	demoEvents.push({
		type: "discovery",
		agent: a,
		approach: [b],
		fellBack: false,
	});
	demoEvents.push({ type: "tick", n: i + 1 });
	demoEvents.push({
		type: "bus",
		event: {
			seq: i + 1,
			time: "2026-10-28T12:00:00Z",
			type: "sent",
			message: {
				id: `demo-${i}`,
				from: a,
				to: b,
				pitch: demoPeople.find((p) => p.id === a)?.pitch ?? "",
				rolesNeeded: demoPeople.find((p) => p.id === b)?.roles ?? [],
			},
		},
	});
	demoEvents.push({
		type: "decision",
		agent: b,
		proposalId: `demo-${i}`,
		decision: { decision: "accept" },
		gateBlocks: i === 2 ? 1 : 0,
		fellBack: false,
		rationale:
			"Our projects point in a similar direction. I want to learn whether the working styles and availability align before going further.",
	});
	demoEvents.push({
		type: "bus",
		event: {
			seq: i + 50,
			time: "2026-10-28T12:00:00Z",
			type: "sent",
			message: {
				decision: "accept",
				proposalId: `demo-${i}`,
				from: b,
				to: a,
			},
		},
	});
	for (const level of [1, 2] as const) {
		demoEvents.push({
			type: "level",
			agent: a,
			other: b,
			from: level === 1 ? 0 : 1,
			to: level,
		});
		demoEvents.push({
			type: "interest",
			agent: b,
			other: a,
			level,
			interest: "continue",
			fellBack: false,
			rationale:
				"There is enough shared direction and complementary experience to keep exploring this partnership.",
		});
	}
	// One pair reshapes the idea at level 2, so the pair view has a change to show.
	if (i === 0) {
		const revision = {
			kind: "revision" as const,
			from: b,
			to: a,
			level: 2 as const,
			pitch: "Screen-free evenings, planned together with the people you live with.",
			rolesNeeded: ["design", "backend"],
		};
		demoEvents.push(
			{
				type: "interest",
				agent: b,
				other: a,
				level: 2,
				interest: "continue",
				revision: {
					pitch: revision.pitch,
					rolesNeeded: revision.rolesNeeded,
				},
				fellBack: false,
				rationale:
					"Households are where screen habits are set, so a shared plan should stick better than a solo one.",
			},
			{
				type: "bus",
				event: {
					seq: 100,
					time: "2026-10-28T12:00:00Z",
					type: "sent",
					message: revision,
				},
			},
			{
				type: "bus",
				event: {
					seq: 101,
					time: "2026-10-28T12:00:00Z",
					type: "sent",
					message: {
						kind: "revisionAnswer",
						from: a,
						to: b,
						adopt: true,
					},
				},
			},
		);
	}
}
for (const [id, members, title] of [
	["t1", ["a01", "a04", "a11"], "Offscreen"],
	["t2", ["a02", "a06"], "Neighborfood"],
	["t3", ["a03", "a08"], "Small Planet"],
] as const) {
	demoEvents.push({
		type: "offers",
		agent: members[0],
		to: members.slice(1),
		places: 3,
		fellBack: false,
	});
	for (const member of members.slice(1))
		demoEvents.push({
			type: "commitment",
			agent: member,
			offers: [members[0]],
			chose: members[0],
			fellBack: false,
		});
	demoEvents.push({
		type: "team",
		team: {
			id,
			members: [...members],
			project: {
				title,
				description:
					"A shared idea, brought together by independent agents.",
			},
			rolesNeeded: ["design"],
			status: "committed",
		},
	});
}

// Validate the fields this browser projection reads, without importing Node-only engine code.
// Additional fields are preserved so additive engine events remain compatible.
const id = z.string().min(1);
const ids = z.array(id);
const rationale = { rationale: z.string().optional() };
const schemas: Record<string, z.ZodType> = {
	listing: z
		.object({
			agent: id,
			pitch: z.string(),
			rolesNeeded: ids,
			gateBlocks: z.number().nonnegative(),
			...rationale,
		})
		.passthrough(),
	round: z.object({ agents: ids }).passthrough(),
	discovery: z
		.object({ agent: id, approach: ids, ...rationale })
		.passthrough(),
	tick: z.object({ n: z.number().int().nonnegative() }).passthrough(),
	decision: z
		.object({
			agent: id,
			decision: z
				.object({ decision: z.enum(["accept", "decline", "counter"]) })
				.passthrough(),
			gateBlocks: z.number().nonnegative(),
			...rationale,
		})
		.passthrough(),
	interest: z
		.object({
			agent: id,
			other: id,
			interest: z.enum(["continue", "withdraw"]),
			...rationale,
		})
		.passthrough(),
	level: z
		.object({
			agent: id,
			other: id,
			from: z.number().int().min(0).max(3),
			to: z.number().int().min(0).max(3),
		})
		.passthrough(),
	offers: z.object({ agent: id, to: ids, ...rationale }).passthrough(),
	commitment: z
		.object({ agent: id, chose: id.nullable(), ...rationale })
		.passthrough(),
	recheck: z
		.object({
			agent: id,
			team: id,
			decision: z.enum(["stay", "leave"]),
			...rationale,
		})
		.passthrough(),
	team: z
		.object({
			team: z
				.object({
					id,
					members: ids.min(2),
					project: z.object({
						title: z.string(),
						description: z.string(),
					}),
					status: z.enum(["tentative", "committed"]),
				})
				.passthrough(),
		})
		.passthrough(),
	bus: z
		.object({
			event: z.discriminatedUnion("type", [
				z
					.object({
						type: z.literal("sent"),
						message: z.object({ from: id, to: id }).passthrough(),
					})
					.passthrough(),
				z
					.object({ type: z.literal("rejected"), reason: z.string() })
					.passthrough(),
			]),
		})
		.passthrough(),
	revisionAnswer: z
		.object({ agent: id, other: id, adopt: z.boolean(), ...rationale })
		.passthrough(),
	hunch: z
		.object({
			agent: id,
			other: id,
			steer: z.enum(["neutral", "explore", "careful", "stop"]),
			...rationale,
		})
		.passthrough(),
	brainstorm: z.object({ agents: ids }).passthrough(),
	stopped: z
		.object({
			rounds: z.number().int().nonnegative(),
			reason: z.enum(["stable", "limit"]),
		})
		.passthrough(),
	exchange: z.object({ type: z.literal("exchange") }).passthrough(),
};
export function parseLog(text: string): Event[] {
	const events: Event[] = [];
	for (const [i, line] of text.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			throw new Error(`Line ${i + 1}: invalid JSON.`);
		}
		const envelope = z.object({ type: id }).passthrough().safeParse(value);
		if (!envelope.success)
			throw new Error(`Line ${i + 1}: expected a run event.`);
		const schema = schemas[envelope.data.type];
		if (schema) {
			const parsed = schema.safeParse(value);
			if (!parsed.success)
				throw new Error(
					`Line ${i + 1}: malformed ${envelope.data.type} event.`,
				);
		}
		events.push(value as Event);
	}
	if (!events.length) throw new Error("This file contains no run events.");
	return events;
}
export function describe(e: Event): string {
	switch (e.type) {
		// Listings are the public board, so the feed shows them in full.
		case "listing":
			return `${e.agent} posted: “${e.pitch}”${e.rolesNeeded.length ? ` · needs ${e.rolesNeeded.join(", ")}` : ""}`;
		case "discovery":
			return `${e.agent} approached ${e.approach.join(", ") || "no new agents"}`;
		case "decision":
			return e.decision.decision === "counter"
				? `${e.agent} countered: “${e.decision.pitch}”`
				: `${e.agent} ${e.decision.decision === "accept" ? "accepted" : "declined"} a proposal`;
		case "interest":
			return e.revision
				? `${e.agent} continued with ${e.other} and proposed a new version: “${e.revision.pitch}”`
				: `${e.agent} ${e.interest === "continue" ? "continued with" : "withdrew from"} ${e.other}`;
		case "revisionAnswer":
			return e.adopt
				? `${e.agent} adopted ${e.other}’s new version of the idea`
				: `${e.agent} kept the current version over ${e.other}’s`;
		case "hunch":
			// The steer is private judgment; only the operator's private view shows the reasoning.
			return `${e.agent} checked privately with their human’s notes`;
		case "brainstorm":
			return `${e.agents.length} people without a team start brainstorming together`;
		case "stopped":
			return e.reason === "stable"
				? `Run settled after ${e.rounds} rounds`
				: `Run stopped at its ${e.rounds}-round limit`;
		case "level":
			return `${e.agent} ↔ ${e.other} unlocked level ${e.to}`;
		case "team":
			return `${e.team.project.title} · ${e.team.members.length} people came together`;
		case "offers":
			return `${e.agent} offered ${e.to.length} team places`;
		case "commitment":
			return e.chose
				? `${e.agent} chose ${e.chose}'s team`
				: `${e.agent} is keeping their options open`;
		case "recheck":
			return `${e.agent} decided to ${e.decision}`;
		case "tick":
			return `Negotiation step ${e.n}`;
		case "round":
			return "A new round of possibilities";
		case "bus":
			return e.event.type === "rejected"
				? `Message blocked: ${e.event.reason}`
				: `${e.event.message.from} → ${e.event.message.to}: ${describeMessage(e.event.message)}`;
		case "exchange":
			return "Private model exchange";
		default:
			return "Run activity";
	}
}
// Shared profile fields in words, e.g. "skills backend (expert), design (beginner) · preferences team of 2–3,
// prefers backend".
function describeShared(
	shared: Extract<AgentMessage, { kind: "share" }>["shared"],
) {
	const { skills, availability: a, preferences: p, projectIdeas } = shared;
	const offset = (h: number) => `UTC${h < 0 ? "−" : "+"}${Math.abs(h)}`;
	const words: Record<string, string | undefined> = {
		...shared,
		skills: skills?.map((s) => `${s.name} (${s.level})`).join(", "),
		interests: shared.interests?.join(", "),
		projectIdeas: projectIdeas?.map((i) => i.title).join(", "),
		availability: a && `${a.hoursPerWeek} h/week, ${offset(a.utcOffset)}`,
		preferences:
			p &&
			[
				p.minTeamSize === p.maxTeamSize
					? `team of ${p.minTeamSize}`
					: `team of ${p.minTeamSize}–${p.maxTeamSize}`,
				...(p.preferredRoles.length > 0
					? [`prefers ${p.preferredRoles.join(", ")}`]
					: []),
			].join(", "),
	};
	return Object.keys(shared)
		.map((k) => `${k} ${words[k] ?? ""}`)
		.join(" · ");
}
// What a bus message says, without its sender and recipient. Mirrors `describeMessage` in
// src/describe.ts, which the browser can't import.
export function describeMessage(m: AgentMessage): string {
	if ("kind" in m) {
		switch (m.kind) {
			case "share":
				return `shared level ${m.level}: ${describeShared(m.shared)}`;
			case "interest":
				return m.interest === "continue"
					? `continues at level ${m.level}`
					: `withdraws at level ${m.level}`;
			case "offer":
				return `offers a place on ${m.team}`;
			case "answer":
				return `answers ${m.answer} (${m.team})`;
			case "leave":
				return `leaves ${m.team}`;
			case "revision":
				return `proposes a new version: “${m.pitch}”`;
			case "revisionAnswer":
				return m.adopt
					? "adopts the new version"
					: "keeps the current version";
		}
	}
	if ("decision" in m) {
		const said =
			"pitch" in m
				? `: “${m.pitch}”`
				: "reason" in m
					? `: “${m.reason}”`
					: "";
		return `${m.decision}${said}`;
	}
	return `proposes “${m.pitch}” · needs ${m.rolesNeeded.join(", ")}`;
}
// Everything between agents `a` and `b`, in order: the messages they sent each other, each one's
// decisions on the other's proposals, and the checks, hunches, and levels one ran about the other.
export function pairEvents(events: Event[], a: string, b: string): Event[] {
	const isPair = (x: string, y: string) =>
		(x === a && y === b) || (x === b && y === a);
	// Decisions name only a proposal id, so match them to the proposals sent between the two.
	const proposals = new Set<string>();
	for (const e of events)
		if (
			e.type === "bus" &&
			e.event.type === "sent" &&
			"id" in e.event.message &&
			isPair(e.event.message.from, e.event.message.to)
		)
			proposals.add(e.event.message.id);
	return events.filter((e) => {
		switch (e.type) {
			case "bus":
				return (
					e.event.type === "sent" &&
					isPair(e.event.message.from, e.event.message.to)
				);
			case "decision":
				return proposals.has(e.proposalId);
			case "interest":
			case "hunch":
			case "revisionAnswer":
			case "level":
				return isPair(e.agent, e.other);
			case "offers":
				return e.to.some((id) => isPair(e.agent, id));
			case "commitment":
				return e.offers.some((id) => isPair(e.agent, id));
			default:
				return false;
		}
	});
}
// One version of the project idea two agents discussed, and what became of it.
export type IdeaVersion = {
	how: "proposal" | "join" | "counter" | "revision" | "offer";
	// Whose idea it is. That's the sender, unless someone asked to join the recipient's project.
	author: string;
	from: string;
	to: string;
	// The project's name in this version, if it was given one.
	title?: string | undefined;
	pitch: string;
	rolesNeeded: string[];
	status:
		| "open"
		| "accepted"
		| "declined"
		| "countered"
		| "adopted"
		| "kept"
		| "committed"
		| "busy";
	// The private reasoning of whoever sent this version, and of whoever answered it, when the log has it.
	why?: string | undefined;
	answerWhy?: string | undefined;
};
// Matches JOIN_PREFIX in src/engine/proposal.ts, which the browser can't import.
const JOIN_PREFIX = "Join your project: ";
// Every version of the idea that passed between `a` and `b`, oldest first, and the index of the one they
// agree on now: the last accepted proposal or counter, adopted revision, or offer committed to. Offers
// carry the version the team will build. Both sides may send a revision at once, so each answer settles
// the latest revision from the agent it answers.
export function ideaVersions(
	events: Event[],
	a: string,
	b: string,
): { versions: IdeaVersion[]; agreed: number | undefined } {
	const versions: IdeaVersion[] = [];
	let agreed: number | undefined;
	let onTable: number | undefined;
	const revised = new Map<string, number>();
	const offered = new Map<string, number>();
	const pair = pairEvents(events, a, b);
	const why = reasons(pair);
	for (const e of pair) {
		if (e.type !== "bus" || e.event.type !== "sent") continue;
		const m = e.event.message;
		// The reasoning behind this message, which settles a version or starts one.
		const reason = why(m);
		const settle = (
			i: number | undefined,
			status: IdeaVersion["status"],
		) => {
			const v = i === undefined ? undefined : versions[i];
			if (v) {
				v.status = status;
				v.answerWhy = reason;
			}
		};
		if (!("kind" in m)) {
			if ("decision" in m) {
				if (m.decision === "accept") {
					settle(onTable, "accepted");
					agreed = onTable;
				} else
					settle(
						onTable,
						m.decision === "decline" ? "declined" : "countered",
					);
				if (m.decision !== "counter") continue;
			}
			// A proposal, or a counter, which is a new proposal back.
			const joins = m.pitch.startsWith(JOIN_PREFIX);
			onTable = versions.length;
			versions.push({
				how: "decision" in m ? "counter" : joins ? "join" : "proposal",
				author: joins ? m.to : m.from,
				from: m.from,
				to: m.to,
				title: m.title,
				pitch: joins ? m.pitch.slice(JOIN_PREFIX.length) : m.pitch,
				rolesNeeded: m.rolesNeeded,
				status: "open",
				why: reason,
			});
		} else if (m.kind === "revision") {
			revised.set(m.from, versions.length);
			versions.push({
				how: "revision",
				author: m.from,
				from: m.from,
				to: m.to,
				title: m.title,
				pitch: m.pitch,
				rolesNeeded: m.rolesNeeded,
				status: "open",
				why: reason,
			});
		} else if (m.kind === "revisionAnswer") {
			const i = revised.get(m.to);
			settle(i, m.adopt ? "adopted" : "kept");
			if (m.adopt) agreed = i;
		} else if (m.kind === "offer") {
			offered.set(m.team, versions.length);
			versions.push({
				how: "offer",
				author: m.from,
				from: m.from,
				to: m.to,
				title: m.title,
				pitch: m.pitch,
				rolesNeeded: m.rolesNeeded,
				status: "open",
				why: reason,
			});
		} else if (m.kind === "answer") {
			const i = offered.get(m.team);
			settle(
				i,
				m.answer === "commit"
					? "committed"
					: m.answer === "busy"
						? "busy"
						: "declined",
			);
			if (m.answer === "commit") agreed = i;
		}
	}
	return { versions, agreed };
}
type Team = Extract<Event, { type: "team" }>["team"];
// One step on the way to a team, by `who`: an offer of places, an answer to one, the owner choosing to lead
// over offers to join others, or a member's re-check after the team grew. `why` is who's private reasoning.
export type TeamStep = {
	who: string;
	what:
		"offered" | "joined" | "declined" | "busy" | "led" | "stayed" | "left";
	// Whom it offered places to; whose offer it answered; or, for "led", whose offers it passed up.
	others: string[];
	why?: string | undefined;
};
// How `team` came about: the idea as it changed in the conversation that founded the team (its owner with
// the first member to join), then every offer, answer, and re-check involving the team, in order.
export function teamStory(
	events: Event[],
	team: Team,
): {
	owner: string;
	founder: string | undefined;
	idea: ReturnType<typeof ideaVersions>;
	steps: TeamStep[];
} {
	const owner = team.members[0]!;
	const founded = events.find(
		(e): e is Extract<Event, { type: "team" }> =>
			e.type === "team" && e.team.id === team.id,
	);
	const founder = founded?.team.members[1] ?? team.members[1];
	const steps: TeamStep[] = [];
	for (const e of events) {
		if (e.type === "offers" && e.agent === owner && e.to.length > 0)
			steps.push({
				who: owner,
				what: "offered",
				others: e.to,
				why: e.rationale,
			});
		if (e.type === "commitment" && e.agent === owner && e.busy)
			steps.push({
				who: owner,
				what: "led",
				others: e.offers,
				why: e.rationale,
			});
		if (
			e.type === "commitment" &&
			e.agent !== owner &&
			e.offers.includes(owner)
		)
			steps.push({
				who: e.agent,
				what:
					e.chose === owner ? "joined" : e.busy ? "busy" : "declined",
				others: [owner],
				why: e.rationale,
			});
		if (e.type === "recheck" && e.team === team.id)
			steps.push({
				who: e.agent,
				what: e.decision === "leave" ? "left" : "stayed",
				others: [],
				why: e.rationale,
			});
	}
	return {
		owner,
		founder,
		idea: founder
			? ideaVersions(events, owner, founder)
			: { versions: [], agreed: undefined },
		steps,
	};
}
// Matches each message between two agents to the private reasoning its sender's model gave for it, from the
// decision, interest, revision answer, offer, or commitment event behind it. Those events can come just
// before or just after their message, so each is looked up by what it's about, oldest first.
function reasons(pair: Event[]): (m: AgentMessage) => string | undefined {
	const queues = new Map<string, (string | undefined)[]>();
	const add = (key: string, why: string | undefined) =>
		queues.set(key, [...(queues.get(key) ?? []), why]);
	for (const e of pair) {
		if (e.type === "decision")
			add(`decision|${e.agent}|${e.proposalId}`, e.rationale);
		if (e.type === "interest" && e.revision)
			add(
				`revision|${e.agent}|${e.other}|${e.revision.pitch}`,
				e.rationale,
			);
		if (e.type === "revisionAnswer")
			add(`answer|${e.agent}|${e.other}`, e.rationale);
		if (e.type === "offers")
			for (const to of e.to) add(`offer|${e.agent}|${to}`, e.rationale);
		if (e.type === "commitment")
			for (const owner of e.offers)
				add(`commit|${e.agent}|${owner}`, e.rationale);
	}
	const take = (key: string) => queues.get(key)?.shift();
	return (m) => {
		if (!("kind" in m))
			return "decision" in m
				? take(`decision|${m.from}|${m.proposalId}`)
				: undefined;
		switch (m.kind) {
			case "revision":
				return take(`revision|${m.from}|${m.to}|${m.pitch}`);
			case "revisionAnswer":
				return take(`answer|${m.from}|${m.to}`);
			case "offer":
				return take(`offer|${m.from}|${m.to}`);
			case "answer":
				return take(`commit|${m.from}|${m.to}`);
			default:
				return undefined;
		}
	};
}
// One entry on the public board: what any agent could see about someone, plus how many agents approached
// them, which only the operator sees.
export type BoardEntry = {
	id: string;
	// Missing for someone looking to join, whom the board shows by id only.
	pitch?: string;
	rolesNeeded: string[];
	// "member" and "owner" have left the board; "owner-open" still has places to fill.
	status: "exploring" | "member" | "owner" | "owner-open";
	// For a member, whose team they joined. Only the operator sees this: on the board they just disappear.
	joined?: string;
	leftTeams: number;
	approachedBy: number;
};
// The board as it stands after `events`: every listing as first posted (the engine keeps the original even
// when the idea is reshaped), then everyone with no project. An owner is still looking if the engine ran
// discovery for them after their team last changed, since it only does that for owners with places left.
export function board(events: Event[]): BoardEntry[] {
	const listings = new Map<
		string,
		{ pitch: string; rolesNeeded: string[] }
	>();
	const everyone = new Set<string>();
	const approachers = new Map<string, Set<string>>();
	const left = new Map<string, number>();
	const teams = new Map<string, string[]>();
	const changed = new Map<string, number>();
	const looked = new Map<string, number>();
	for (const [i, e] of events.entries()) {
		if (e.type === "round") e.agents.forEach((id) => everyone.add(id));
		if (e.type === "listing") {
			everyone.add(e.agent);
			listings.set(e.agent, {
				pitch: e.pitch,
				rolesNeeded: e.rolesNeeded,
			});
		}
		if (e.type === "discovery") {
			looked.set(e.agent, i);
			for (const id of e.approach) {
				if (!approachers.has(id)) approachers.set(id, new Set());
				approachers.get(id)!.add(e.agent);
			}
		}
		if (e.type === "team") {
			teams.set(e.team.id, e.team.members);
			changed.set(e.team.id, i);
		}
		// A team left with only its owner dissolves without a team event, so drop the leaver here.
		if (e.type === "recheck" && e.decision === "leave") {
			left.set(e.agent, (left.get(e.agent) ?? 0) + 1);
			const members = (teams.get(e.team) ?? []).filter(
				(id) => id !== e.agent,
			);
			if (members.length >= 2) teams.set(e.team, members);
			else teams.delete(e.team);
			changed.set(e.team, i);
		}
	}
	const status = (
		id: string,
		team: [string, string[]] | undefined,
	): BoardEntry["status"] => {
		if (!team) return "exploring";
		if (team[1][0] !== id) return "member";
		return (looked.get(id) ?? -1) > changed.get(team[0])!
			? "owner-open"
			: "owner";
	};
	const entry = (id: string): BoardEntry => {
		const team = [...teams].find(([, members]) => members.includes(id));
		const owner = team?.[1][0];
		return {
			id,
			...listings.get(id),
			rolesNeeded: listings.get(id)?.rolesNeeded ?? [],
			status: status(id, team),
			...(owner !== undefined && owner !== id && { joined: owner }),
			leftTeams: left.get(id) ?? 0,
			approachedBy: approachers.get(id)?.size ?? 0,
		};
	};
	return [
		...[...listings.keys()].map(entry),
		...[...everyone].filter((id) => !listings.has(id)).map(entry),
	];
}
export function project(events: Event[]) {
	const people = new Map<string, Person>();
	const links = new Map<string, { a: string; b: string; level: number }>();
	const teams = new Map<string, Extract<Event, { type: "team" }>["team"]>();
	let gates = 0;
	let tick = 0;
	const ensure = (id: string) => {
		if (!people.has(id))
			people.set(id, {
				id,
				pitch: "Waiting for a public listing.",
				roles: [],
			});
	};
	for (const e of events) {
		if ("agent" in e && typeof e.agent === "string") ensure(e.agent);
		if (e.type === "round") e.agents.forEach(ensure);
		if (e.type === "listing")
			people.set(e.agent, {
				id: e.agent,
				pitch: e.pitch,
				roles: e.rolesNeeded,
			});
		if (e.type === "discovery")
			for (const b of e.approach) {
				ensure(b);
				const key = [e.agent, b].sort().join(":");
				if (!links.has(key))
					links.set(key, { a: e.agent, b, level: 0 });
			}
		if (e.type === "level") {
			ensure(e.other);
			const key = [e.agent, e.other].sort().join(":");
			links.set(key, { a: e.agent, b: e.other, level: e.to });
		}
		// Interest events only carry gate blocks in newer logs.
		if ("gateBlocks" in e) gates += e.gateBlocks ?? 0;
		if (e.type === "bus" && e.event.type === "rejected") gates++;
		if (e.type === "tick") tick = e.n;
		if (e.type === "team") teams.set(e.team.id, e.team);
		// A team left with only its owner dissolves without a team event, so drop it here.
		if (e.type === "recheck" && e.decision === "leave") {
			const team = teams.get(e.team);
			const members = team?.members.filter((id) => id !== e.agent) ?? [];
			if (team && members.length >= 2)
				teams.set(e.team, { ...team, members });
			else teams.delete(e.team);
		}
	}
	return {
		people: [...people.values()],
		links: [...links.values()],
		teams: [...teams.values()],
		gates,
		tick,
	};
}
