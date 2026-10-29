import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadPeople, PilotPerson } from "../../src/pilot/person.js";

// The example everyone copies must itself be valid.
const example = PilotPerson.parse(
	JSON.parse(readFileSync("profiles/example.json", "utf8")),
);

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// A folder holding `files`, each written as JSON (or as is, if a string).
function folder(files: Record<string, unknown>): string {
	dir = mkdtempSync(join(tmpdir(), "people-"));
	for (const [name, content] of Object.entries(files)) {
		writeFileSync(
			join(dir, name),
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}
	return dir;
}

const withId = (id: string) => ({
	...example,
	profile: { ...example.profile, id },
});

describe("loadPeople", () => {
	test("reads every person in file name order, with notes defaulting to none", () => {
		const { notes: _, ...noNotes } = withId("p-bbbb");
		const people = loadPeople(
			folder({
				"b.json": noNotes,
				"a.json": withId("p-aaaa"),
				"readme.txt": "ignored",
			}),
		);
		expect(people.map((p) => p.profile.id)).toEqual(["p-aaaa", "p-bbbb"]);
		expect(people[0]!.notes).toHaveLength(3);
		expect(people[1]!.notes).toEqual([]);
	});

	test("lists every problem, with its file and field, before failing", () => {
		const bad = {
			...example,
			profile: {
				...example.profile,
				id: "sam",
				skills: [{ name: "typescript", level: "expert" }],
			},
			notes: [{ text: "Secret.", level: 5 }],
		};
		expect(() =>
			loadPeople(folder({ "bad.json": bad, "broken.json": "{ nope" })),
		).toThrow(
			expect.objectContaining({
				message: expect.stringMatching(
					/bad\.json: profile\.id must be "p-"[\s\S]*bad\.json: profile\.skills\.0\.name must be one of frontend[\s\S]*bad\.json: notes\.0\.level[\s\S]*broken\.json: not valid JSON/,
				),
			}),
		);
	});

	test("two people can't share an id", () => {
		expect(() =>
			loadPeople(
				folder({
					"a.json": withId("p-same"),
					"b.json": withId("p-same"),
				}),
			),
		).toThrow('b.json: profile.id "p-same" is also used by a.json');
	});

	test("an empty folder is a problem, not an empty run", () => {
		expect(() => loadPeople(folder({}))).toThrow("no .json files");
	});
});
