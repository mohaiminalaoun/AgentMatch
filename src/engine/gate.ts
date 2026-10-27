import { isDeepStrictEqual } from "node:util";
import {
	FIELD_LEVELS,
	fieldsAtLevel,
	type DisclosureLevel,
	type ProfileField,
} from "./disclosure.js";
import type { Profile } from "./profile.js";
import type { Decision, Terms } from "./proposal.js";

// What an agent is about to send: free-text parts by name (such as a pitch) and any structured profile data.
export type Draft = {
	texts: Record<string, string | undefined>;
	shared?: Partial<Profile>;
};

// One thing a draft reveals that the current level doesn't allow.
export type Violation = {
	field: string;
	// Where it was found: "shared" or the name of a text part.
	where: string;
	// The word or phrase that gave it away, or why the shared value is wrong.
	match: string;
};

// Other ways people name a role, so "server-side" counts as revealing a backend skill.
// A safety net only: paraphrases outside this list get through, which is why free text is kept minimal.
const ROLE_SYNONYMS: Record<string, string[]> = {
	frontend: ["front-end", "front end"],
	backend: ["back-end", "back end", "server-side", "server side"],
	mobile: ["ios", "android"],
	ml: ["machine learning"],
	data: ["data science", "data scientist", "data engineer"],
	design: ["designer", "ux"],
	devops: ["dev ops", "infrastructure", "sre"],
	product: ["product manager"],
};

// Checks a draft against what `sender` may share at `level`, with no LLM involved.
// Returns every violation found; an empty list means the draft may be sent.
export function checkDisclosure(
	sender: Profile,
	level: DisclosureLevel,
	draft: Draft,
): Violation[] {
	return [
		...checkShared(sender, level, draft.shared ?? {}),
		...checkTexts(sender, level, draft.texts),
	];
}

// The free-text parts of a decision or proposal, for checking before it's sent.
// Only pitches have free text: accepts and declines carry none the model wrote.
export function draftOf(message: Decision | Terms): Draft {
	return "pitch" in message
		? { texts: { pitch: message.pitch } }
		: { texts: {} };
}

// Structured data must stay within the level and match the sender's real profile exactly.
function checkShared(
	sender: Profile,
	level: DisclosureLevel,
	shared: Partial<Profile>,
): Violation[] {
	return Object.entries(shared).flatMap(([key, value]): Violation[] => {
		if (!(key in FIELD_LEVELS)) {
			return [
				{ field: key, where: "shared", match: "not a profile field" },
			];
		}
		const field = key as ProfileField;
		if (FIELD_LEVELS[field] > level) {
			return [
				{
					field,
					where: "shared",
					match: `needs level ${FIELD_LEVELS[field]}`,
				},
			];
		}
		if (!isDeepStrictEqual(value, sender[field])) {
			return [
				{ field, where: "shared", match: "doesn't match the profile" },
			];
		}
		return [];
	});
}

// Searches free text for the sender's own values from fields above the level,
// skipping any value that's already public through a field the level allows.
function checkTexts(
	sender: Profile,
	level: DisclosureLevel,
	texts: Record<string, string | undefined>,
): Violation[] {
	const allowed = fieldsAtLevel(sender, level);
	const publicText = JSON.stringify(allowed);
	const hidden = (Object.keys(FIELD_LEVELS) as ProfileField[]).filter(
		(field) => FIELD_LEVELS[field] > level,
	);
	const violations: Violation[] = [];
	for (const [where, text] of Object.entries(texts)) {
		if (!text) {
			continue;
		}
		for (const field of hidden) {
			for (const term of revealingTerms(sender, field)) {
				if (mentions(text, term) && !mentions(publicText, term)) {
					violations.push({ field, where, match: term });
				}
			}
		}
	}
	return violations;
}

// Words and phrases that would reveal `field` of `profile` if they appeared in a message.
function revealingTerms(profile: Profile, field: ProfileField): string[] {
	switch (field) {
		case "name":
			return [profile.name];
		case "skills":
			return profile.skills.flatMap((s) => withSynonyms(s.name));
		case "interests":
			return profile.interests;
		case "preferences":
			return profile.preferences.preferredRoles.flatMap(withSynonyms);
		case "availability": {
			const { hoursPerWeek, utcOffset } = profile.availability;
			const sign = utcOffset < 0 ? "-" : "+";
			const offset = String(Math.abs(utcOffset));
			return [
				`${hoursPerWeek} hours`,
				`${hoursPerWeek} hrs`,
				`UTC${sign}${offset}`,
				`GMT${sign}${offset}`,
			];
		}
		case "id":
		case "projectIdeas":
			// Level 0: always public, never a leak.
			return [];
	}
}

// A role name plus the other ways people say it.
function withSynonyms(role: string): string[] {
	return [role, ...(ROLE_SYNONYMS[role.toLowerCase()] ?? [])];
}

// Whether `text` contains `term` as a whole word or phrase, ignoring case,
// so the skill "ml" doesn't match inside "html". A space in `term` matches one or more
// spaces, never none, so "back end" doesn't also match "backend".
function mentions(text: string, term: string): boolean {
	const escaped = term
		.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\s+/g, "\\s+");
	return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}
