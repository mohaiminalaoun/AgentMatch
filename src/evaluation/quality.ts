import { CORE_ROLES, type Profile } from "../engine/profile.js";

type SkillLevel = Profile["skills"][number]["level"];

const LEVEL_WEIGHT: Record<SkillLevel, number> = {
	beginner: 0.5,
	intermediate: 0.75,
	expert: 1,
};

// Everyone is assumed to work 9:00 to 17:00 in their own time zone.
const WORKDAY_START = 9;
const WORKDAY_END = 17;
const WORKDAY_HOURS = WORKDAY_END - WORKDAY_START;
// Check the clock in 15-minute steps, which handles zones like +5.75 (Nepal).
const SLOT_HOURS = 0.25;

// For each core role, the best level anyone on the team has (0 if nobody), averaged.
export function skillCoverage(members: readonly Profile[]): number {
	const total = CORE_ROLES.reduce(
		(sum, role) => sum + bestLevel(members, role),
		0,
	);
	return total / CORE_ROLES.length;
}

// The highest skill weight any member has for `role`, or 0 if nobody has it.
function bestLevel(members: readonly Profile[], role: string): number {
	let best = 0;
	for (const member of members) {
		for (const skill of member.skills) {
			if (skill.name === role) {
				best = Math.max(best, LEVEL_WEIGHT[skill.level]);
			}
		}
	}
	return best;
}

// 0 when nobody shares an interest, 1 when everyone shares one.
export function sharedInterest(members: readonly Profile[]): number {
	if (members.length < 2) {
		return 0;
	}
	const counts = new Map<string, number>();
	for (const member of members) {
		for (const interest of new Set(member.interests)) {
			counts.set(interest, (counts.get(interest) ?? 0) + 1);
		}
	}
	const largestGroup = Math.max(1, ...counts.values());
	return (largestGroup - 1) / (members.length - 1);
}

// Hours per day when every member is inside their workday, out of a full workday.
export function availabilityOverlap(members: readonly Profile[]): number {
	if (members.length === 0) {
		return 0;
	}
	let sharedSlots = 0;
	for (let utc = 0; utc < 24; utc += SLOT_HOURS) {
		if (members.every((m) => isWorking(m.availability.utcOffset, utc))) {
			sharedSlots++;
		}
	}
	return (sharedSlots * SLOT_HOURS) / WORKDAY_HOURS;
}

// Whether someone at `utcOffset` is inside their 9-to-5 at the given UTC hour.
function isWorking(utcOffset: number, utcHour: number): boolean {
	// Wrap into [0, 24), since one person's 9:00 can be another's previous day.
	const local = (((utcHour + utcOffset) % 24) + 24) % 24;
	return local >= WORKDAY_START && local < WORKDAY_END;
}

// The three parts weighted equally: 0 is a terrible team, 1 is an ideal one.
export function scoreTeam(members: readonly Profile[]): number {
	return (
		(skillCoverage(members) +
			sharedInterest(members) +
			availabilityOverlap(members)) /
		3
	);
}
