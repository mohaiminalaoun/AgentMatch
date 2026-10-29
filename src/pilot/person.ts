import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

// Reads every .json file in `dir` as one person, in file name order. Collects every problem across all the
// files before failing, each with its file and field, so they can all be fixed in one go.
export function loadPeople(dir: string): PilotPerson[] {
	const files = readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort();
	const problems: string[] = [];
	const people: PilotPerson[] = [];
	const ids = new Map<string, string>();
	for (const file of files) {
		let json: unknown;
		try {
			json = JSON.parse(readFileSync(join(dir, file), "utf8"));
		} catch (error) {
			problems.push(
				`${file}: not valid JSON (${(error as Error).message})`,
			);
			continue;
		}
		const parsed = PilotPerson.safeParse(json);
		if (!parsed.success) {
			problems.push(
				...parsed.error.issues.map(
					(issue) =>
						`${file}: ${issue.path.join(".") || "(whole file)"} ${issue.message}`,
				),
			);
			continue;
		}
		const { id } = parsed.data.profile;
		const other = ids.get(id);
		if (other) {
			problems.push(
				`${file}: profile.id "${id}" is also used by ${other}`,
			);
			continue;
		}
		ids.set(id, file);
		people.push(parsed.data);
	}
	if (files.length === 0) {
		problems.push(`no .json files in ${dir}`);
	}
	if (problems.length > 0) {
		throw new Error(
			[
				`People in ${dir} have problems:`,
				...problems.map((p) => `- ${p}`),
			].join("\n"),
		);
	}
	return people;
}
