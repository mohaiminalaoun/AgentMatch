// What code can say about how well an agent's human and another person fit, from the agent's own profile and
// only what the other side has shared, each item labelled: facts (shared values and arithmetic on them),
// estimates (arithmetic resting on a stated assumption), and unknowns (what nobody has said yet, and what a
// profile can't say at all). Prompts get it as text, so agents reason from the same numbers instead of
// eyeballing time zones, sizes, and roles. It goes into prompts only and is never sent.
import { contactOf, type AgentState } from "./agent.js";
import type { DisclosureLevel } from "./disclosure.js";
import type { Profile } from "./profile.js";

// The working day the overlap estimate assumes: 9:00 to 17:00 in each person's own time zone. Only an
// assumption: profiles don't say when anyone works, least of all on a side project.
export const WORKDAY_START = 9;
export const WORKDAY_END = 17;
export const WORKDAY_HOURS = WORKDAY_END - WORKDAY_START;
// The clock is checked in 15-minute steps, which handles zones like +5.75 (Nepal).
const SLOT_HOURS = 0.25;

// Hours a day when everyone at `utcOffsets` would be inside their assumed working day at once.
export function workdayOverlapHours(utcOffsets: readonly number[]): number {
	if (utcOffsets.length === 0) {
		return 0;
	}
	let slots = 0;
	for (let utc = 0; utc < 24; utc += SLOT_HOURS) {
		if (utcOffsets.every((offset) => isWorking(offset, utc))) {
			slots++;
		}
	}
	return slots * SLOT_HOURS;
}

// Whether someone at `utcOffset` is inside the assumed working day at the given UTC hour.
function isWorking(utcOffset: number, utcHour: number): boolean {
	// Wrap into [0, 24), since one person's 9:00 can be another's previous day.
	const local = (((utcHour + utcOffset) % 24) + 24) % 24;
	return local >= WORKDAY_START && local < WORKDAY_END;
}

// How far apart two time zones are, the short way around the clock.
export function timeZoneGap(a: number, b: number): number {
	const d = Math.abs(a - b) % 24;
	return Math.min(d, 24 - d);
}

type Side = {
	utcOffset?: number;
	hoursPerWeek?: number;
	interests?: string[];
	skills?: Profile["skills"];
	teamSize?: readonly [min: number, max: number];
};

// What the agent knows about itself and `other` at the current level, and what follows from it.
export type FitFacts = {
	other: string;
	level: DisclosureLevel;
	you: Required<Side>;
	them: Side;
	// Only once their time zone is known.
	timeZoneGap?: number;
	workdayOverlap?: number;
	// Only once their sizes are known: the team sizes that suit both, or null if none do.
	sizesForBoth?: readonly [min: number, max: number] | null;
	// Only once their interests are known: interests both listed, word for word.
	sharedInterests?: string[];
};

// The facts for `agent` about `otherId`, from its own profile and what `otherId` has shared with it.
export function fitFacts(agent: AgentState, otherId: string): FitFacts {
	const { profile } = agent;
	const contact = contactOf(agent, otherId);
	const learned = contact.learned;
	const you = {
		utcOffset: profile.availability.utcOffset,
		hoursPerWeek: profile.availability.hoursPerWeek,
		interests: profile.interests,
		skills: profile.skills,
		teamSize: [
			profile.preferences.minTeamSize,
			profile.preferences.maxTeamSize,
		] as const,
	};
	const them: Side = {
		...(learned.availability && {
			utcOffset: learned.availability.utcOffset,
			hoursPerWeek: learned.availability.hoursPerWeek,
		}),
		...(learned.interests && { interests: learned.interests }),
		...(learned.skills && { skills: learned.skills }),
		...(learned.preferences && {
			teamSize: [
				learned.preferences.minTeamSize,
				learned.preferences.maxTeamSize,
			] as const,
		}),
	};
	const lo = them.teamSize && Math.max(you.teamSize[0], them.teamSize[0]);
	const hi = them.teamSize && Math.min(you.teamSize[1], them.teamSize[1]);
	return {
		other: otherId,
		level: contact.level,
		you,
		them,
		...(them.utcOffset !== undefined && {
			timeZoneGap: timeZoneGap(you.utcOffset, them.utcOffset),
			workdayOverlap: workdayOverlapHours([
				you.utcOffset,
				them.utcOffset,
			]),
		}),
		...(lo !== undefined &&
			hi !== undefined && {
				sizesForBoth: lo <= hi ? ([lo, hi] as const) : null,
			}),
		...(them.interests && {
			sharedInterests: you.interests.filter((i) =>
				them.interests!.includes(i),
			),
		}),
	};
}

const utc = (offset: number) =>
	`UTC${offset >= 0 ? "+" : "-"}${Math.abs(offset)}`;
const skillList = (skills: Profile["skills"]) =>
	skills.map((s) => `${s.name} (${s.level})`).join(", ");
const range = ([min, max]: readonly [number, number]) =>
	min === max ? `${min}` : `${min} to ${max}`;
const hours = (n: number) =>
	`${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "")} hour${n === 1 ? "" : "s"}`;

// The facts as a prompt block, in three labelled parts, so the model can tell what's known from what's assumed
// and what isn't known at all.
export function factsText(f: FitFacts): string {
	const facts: string[] = [];
	if (f.them.utcOffset !== undefined) {
		facts.push(
			`Time zones: your human ${utc(f.you.utcOffset)}, ${f.other} ${utc(f.them.utcOffset)} (${hours(f.timeZoneGap!)} apart).`,
		);
	}
	if (f.them.hoursPerWeek !== undefined) {
		facts.push(
			`Hours a week: your human ${f.you.hoursPerWeek}, ${f.other} ${f.them.hoursPerWeek}.`,
		);
	}
	if (f.sharedInterests) {
		facts.push(
			f.sharedInterests.length > 0
				? `Interests both listed, word for word: ${f.sharedInterests.join(", ")}. Similar but differently worded interests may overlap too; judge that yourself.`
				: "No interest is listed by both word for word. Similar but differently worded interests may still overlap; judge that yourself.",
		);
	}
	facts.push(`Your human's skills: ${skillList(f.you.skills)}.`);
	if (f.them.skills) {
		facts.push(`${f.other}'s skills: ${skillList(f.them.skills)}.`);
	}
	if (f.them.teamSize) {
		facts.push(
			`Team size: your human wants ${range(f.you.teamSize)} people, ${f.other} wants ${range(f.them.teamSize)}; ${f.sizesForBoth ? `sizes that suit both: ${range(f.sizesForBoth)}` : "no size suits both"}.`,
		);
	}

	const estimates =
		f.workdayOverlap === undefined
			? []
			: [
					`If both worked ${WORKDAY_START}:00 to ${WORKDAY_END}:00 in their own time zone, their working days would overlap about ${hours(f.workdayOverlap)} a day. That is an assumption, not a fact: nobody has said when they work, and side projects often happen outside working hours.`,
				];

	const unknowns = [
		...(f.them.utcOffset === undefined
			? [
					`${f.other}'s interests, time zone, and weekly hours: not shared yet (they come at level 1).`,
				]
			: []),
		...(f.them.skills === undefined
			? [
					`${f.other}'s skills and team size: not shared yet (they come at level 2). Don't assume they have any skill or would fill any role.`,
				]
			: []),
		"When anyone actually works or can meet: time zones and weekly hours don't say.",
		"Roles a pitch doesn't list: unknown. Its author may cover them, so they aren't necessarily open.",
		"One person may cover several roles, so the number of roles isn't the number of people. Whether someone's weekly hours stretch to all their roles is a judgment, not a fact.",
	];

	return [
		`Facts about you and ${f.other} (computed by code from your human's profile and what ${f.other} has shared):`,
		...facts.map((line) => `- ${line}`),
		...(estimates.length > 0
			? [
					"Estimates (resting on an assumption):",
					...estimates.map((l) => `- ${l}`),
				]
			: []),
		"Unknown:",
		...unknowns.map((line) => `- ${line}`),
	].join("\n");
}
