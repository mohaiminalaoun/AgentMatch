import { z } from "zod";
import type { Profile } from "./profile.js";

// 0: pitch, 1: interest area and availability, 2: skills and constraints,
// 3: specifics, only after mutual interest.
export const DisclosureLevel = z.literal([0, 1, 2, 3]);
export type DisclosureLevel = z.infer<typeof DisclosureLevel>;

export type ProfileField = keyof Profile;

// `satisfies` makes adding a field to Profile a compile error until it gets a level here.
export const FIELD_LEVELS = {
	id: 0,
	projectIdeas: 0,
	interests: 1,
	availability: 1,
	skills: 2,
	preferences: 2,
	name: 3,
} as const satisfies Record<ProfileField, DisclosureLevel>;

export function fieldsAtLevel(
	profile: Profile,
	level: DisclosureLevel,
): Partial<Profile> {
	const allowed = (Object.keys(FIELD_LEVELS) as ProfileField[]).filter(
		(field) => FIELD_LEVELS[field] <= level,
	);
	return Object.fromEntries(
		allowed.map((field) => [field, profile[field]]),
	) as Partial<Profile>;
}
