import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	listPeople,
	loadPeople,
	removePerson,
	savePerson,
} from "../../src/pilot/people.js";
import { PilotPerson } from "../../src/pilot/person.js";

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

	test("the example is never loaded as a person, and its id is free to use", () => {
		const people = loadPeople(
			folder({
				"example.json": example,
				"me.json": withId(example.profile.id),
			}),
		);
		expect(people.map((p) => p.profile.id)).toEqual([example.profile.id]);
		expect(() => loadPeople(folder({ "example.json": example }))).toThrow(
			"no .json files",
		);
	});
});

describe("saving, listing, and removing people", () => {
	test("a valid person is saved as <id>.json and listed by name, without the example", () => {
		const dir = folder({ "example.json": example });
		const result = savePerson(dir, withId("p-new1"));
		expect(result).toMatchObject({
			saved: {
				id: "p-new1",
				name: "Sam Rivera",
				notes: 3,
				file: "p-new1.json",
			},
		});
		expect(listPeople(dir).map((p) => p.id)).toEqual(["p-new1"]);
		expect(loadPeople(dir).map((p) => p.profile.id)).toEqual(["p-new1"]);
	});

	test("an invalid person isn't saved, and every problem comes back", () => {
		const dir = folder({});
		const bad = { ...example, profile: { ...example.profile, id: "sam" } };
		expect(savePerson(dir, bad)).toEqual({
			problems: [expect.stringContaining('profile.id must be "p-"')],
		});
		expect(listPeople(dir)).toEqual([]);
	});

	test("an id already in use is refused, unless replacing that person's own file", () => {
		const dir = folder({});
		savePerson(dir, withId("p-dup1"));
		expect(savePerson(dir, withId("p-dup1"))).toEqual({
			problems: [expect.stringContaining("save again to replace it")],
		});
		expect(
			savePerson(dir, withId("p-dup1"), { replace: true }),
		).toHaveProperty("saved");
	});

	test("removing finds the person by id, whatever their file is called", () => {
		const dir = folder({ "mohaimin.json": withId("p-mine") });
		expect(removePerson(dir, "p-mine")).toBe(true);
		expect(removePerson(dir, "p-mine")).toBe(false);
		expect(listPeople(dir)).toEqual([]);
	});
});
