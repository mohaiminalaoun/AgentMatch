// How much private information reached people who didn't end up on your team: the real privacy cost of
// matching, since telling your teammates things is the point.
import { FIELD_LEVELS, type ProfileField } from "../engine/disclosure.js";
import type { World } from "../engine/round.js";

// The fields that are private at level 0: everything but the id and project ideas, which are public.
export const PRIVATE_FIELDS = (
	Object.keys(FIELD_LEVELS) as ProfileField[]
).filter((field) => FIELD_LEVELS[field] > 0);

export type Leakage = {
	// Private fields that reached someone not on the sender's team, out of every private field going to
	// every other person: 0 is nothing leaked, 1 is everyone told everyone everything (a full broadcast).
	rate: number;
	// How many times each private field reached someone outside the sender's team.
	byField: Record<string, number>;
	// The same count for each person, as a sender.
	byAgent: Record<string, number>;
};

// Counts, from what each agent recorded as revealed to each contact (shares and anything its messages
// mentioned), the private fields that went to people outside its final team. Notes are never sent as data,
// so they can't add to it.
export function measureLeakage(world: World): Leakage {
	const ids = Object.keys(world.agents);
	const teammates = (a: string, b: string) =>
		world.teams.some((t) => t.members.includes(a) && t.members.includes(b));
	const byField: Record<string, number> = Object.fromEntries(
		PRIVATE_FIELDS.map((field) => [field, 0]),
	);
	const byAgent: Record<string, number> = {};
	let leaked = 0;
	for (const id of ids) {
		byAgent[id] = 0;
		for (const [other, contact] of Object.entries(
			world.agents[id]!.contacts,
		)) {
			if (teammates(id, other)) {
				continue;
			}
			for (const field of contact.revealed) {
				if (field in byField) {
					byField[field]!++;
					byAgent[id]!++;
					leaked++;
				}
			}
		}
	}
	const possible = ids.length * (ids.length - 1) * PRIVATE_FIELDS.length;
	return { rate: possible === 0 ? 0 : leaked / possible, byField, byAgent };
}
