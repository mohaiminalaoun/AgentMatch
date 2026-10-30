import { z } from "zod";
import { Note } from "../engine/notes.js";
import { Profile, ROLES } from "../engine/profile.js";

// Ids are public on the board, so a real person's id says nothing about them: "p-" and a few random letters or
// digits. Generated people use "p1", "p2", …, so the two can never clash.
export const PERSON_ID = /^p-[a-z0-9]{4,12}$/;

const role = z.enum(ROLES, {
	error: `must be one of ${ROLES.join(", ")}`,
});

// One real person taking part: their profile and private notes, which their agent works from, and how
// teammates can reach them, which no agent ever sees: it's shown only once everyone on a team approves it.
export const PilotPerson = z.object({
	profile: Profile.safeExtend({
		id: z.string().regex(PERSON_ID, {
			error: 'must be "p-" and 4 to 12 random lowercase letters or digits, like "p-4k2m"',
		}),
		// Matching works on roles, so skills and preferred roles must name one.
		skills: z
			.array(Profile.shape.skills.element.extend({ name: role }))
			.min(1),
		preferences: Profile.shape.preferences.safeExtend({
			preferredRoles: z.array(role),
		}),
	}),
	notes: z.array(Note).default([]),
	contact: z.string().min(1).optional(),
});

export type PilotPerson = z.infer<typeof PilotPerson>;

// Checks `json` as one person: the person, or every problem with it as "field message", so all of them can be
// fixed in one go. Safe in the browser, so a form can check before anything is saved.
export function checkPerson(
	json: unknown,
): { person: PilotPerson; problems?: undefined } | { problems: string[] } {
	const parsed = PilotPerson.safeParse(json);
	return parsed.success
		? { person: parsed.data }
		: {
				problems: parsed.error.issues.map(
					(issue) =>
						`${issue.path.join(".") || "(whole file)"} ${issue.message}`,
				),
			};
}

// A fresh id for a new person: "p-" and 6 random lowercase letters or digits.
export function newPersonId(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = crypto.getRandomValues(new Uint8Array(6));
	return `p-${[...bytes].map((b) => chars[b % chars.length]).join("")}`;
}
