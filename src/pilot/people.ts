import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkPerson, type PilotPerson } from "./person.js";

// Reads every .json file in `dir` but the example as one person, in file name order. Collects every problem across all the
// files before failing, each with its file and field, so they can all be fixed in one go.
export function loadPeople(dir: string): PilotPerson[] {
	const files = jsonFiles(dir);
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
		const checked = checkPerson(json);
		if (checked.problems) {
			problems.push(...checked.problems.map((p) => `${file}: ${p}`));
			continue;
		}
		const { id } = checked.person.profile;
		const other = ids.get(id);
		if (other) {
			problems.push(
				`${file}: profile.id "${id}" is also used by ${other}`,
			);
			continue;
		}
		ids.set(id, file);
		people.push(checked.person);
	}
	if (files.length === 0) {
		problems.push(`no .json files in ${dir} besides ${EXAMPLE}`);
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

// One saved person as a list shows them: enough to recognize, nothing private.
export type PersonSummary = {
	id: string;
	name: string;
	skills: string[];
	notes: number;
	file: string;
};

// Everyone saved in `dir` who reads as a valid person, by name.
export function listPeople(dir: string): PersonSummary[] {
	return jsonFiles(dir)
		.flatMap((file) => {
			try {
				const checked = checkPerson(
					JSON.parse(readFileSync(join(dir, file), "utf8")),
				);
				if (checked.problems) {
					return [];
				}
				const { profile, notes } = checked.person;
				return [
					{
						id: profile.id,
						name: profile.name,
						skills: profile.skills.map(
							(s) => `${s.name} (${s.level})`,
						),
						notes: notes.length,
						file,
					},
				];
			} catch {
				return [];
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

// Saves `json` as `<id>.json` in `dir` if it's a valid person whose id no other file uses; replacing that
// person's own file only when `replace` is set. Returns the problems instead if not.
export function savePerson(
	dir: string,
	json: unknown,
	{ replace = false }: { replace?: boolean } = {},
): { saved: PersonSummary } | { problems: string[] } {
	const checked = checkPerson(json);
	if (checked.problems) {
		return { problems: checked.problems };
	}
	const { id } = checked.person.profile;
	const file = `${id}.json`;
	const taken = listPeople(dir).find((p) => p.id === id);
	if (taken && (taken.file !== file || !replace)) {
		return {
			problems: [
				`profile.id "${id}" is already used by ${taken.name} (${taken.file})${taken.file === file ? "; save again to replace it" : ""}`,
			],
		};
	}
	writeFileSync(
		join(dir, file),
		`${JSON.stringify(checked.person, null, "\t")}\n`,
	);
	return { saved: listPeople(dir).find((p) => p.id === id)! };
}

// Deletes the saved person with `id`, whatever their file is called. Returns whether there was one.
export function removePerson(dir: string, id: string): boolean {
	const person = listPeople(dir).find((p) => p.id === id);
	if (!person) {
		return false;
	}
	unlinkSync(join(dir, person.file));
	return true;
}

// The made-up person everyone copies. It isn't anyone, so it's never loaded, listed, or matched.
const EXAMPLE = "example.json";

// Every person's file in `dir`: its .json files, except the example.
function jsonFiles(dir: string): string[] {
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && name !== EXAMPLE)
		.sort();
}
