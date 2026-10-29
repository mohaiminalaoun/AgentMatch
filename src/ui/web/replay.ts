import { z } from "zod";
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
		type: "decision",
		agent: b,
		proposalId: `demo-${i}`,
		decision: { decision: "accept" },
		gateBlocks: i === 2 ? 1 : 0,
		fellBack: false,
		rationale:
			"Our projects point in a similar direction. I want to learn whether the working styles and availability align before going further.",
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
				: `${e.event.message.from} → ${e.event.message.to}`;
		case "exchange":
			return "Private model exchange";
		default:
			return "Run activity";
	}
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
	}
	return {
		people: [...people.values()],
		links: [...links.values()],
		teams: [...teams.values()],
		gates,
		tick,
	};
}
