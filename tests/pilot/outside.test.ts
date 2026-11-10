import { describe, expect, test } from "vitest";
import { parseOutsides, pollSecondsFor } from "../../src/pilot/outside.js";

const argv = (...rest: string[]) => [
	"node",
	"pilot-run.ts",
	"profiles",
	...rest,
];

describe("parseOutsides", () => {
	test("no --outside is no outside agents", () => {
		expect(parseOutsides(argv("--fill", "2"))).toEqual([]);
	});

	test("reads one, as the pilot always did", () => {
		expect(parseOutsides(argv("--outside", "p-4k2m=muse"))).toEqual([
			{ person: "p-4k2m", agent: "muse" },
		]);
	});

	test("reads several, in order, wherever the other flags are", () => {
		expect(
			parseOutsides(
				argv(
					"--rounds",
					"2",
					"--outside",
					"p-aaaa=muse",
					"--fill",
					"1",
					"--outside",
					"p-bbbb=grokbot",
					"--poll-seconds",
					"3",
				),
			),
		).toEqual([
			{ person: "p-aaaa", agent: "muse" },
			{ person: "p-bbbb", agent: "grokbot" },
		]);
	});

	test.each([
		["no value", argv("--outside")],
		["another flag as the value", argv("--outside", "--fill", "1")],
		["no agent", argv("--outside", "p-4k2m")],
		["a person that is not a p- id", argv("--outside", "p1=muse")],
		["an agent with a stray period", argv("--outside", "p-4k2m=muse.")],
		[
			"a second flag that is wrong",
			argv("--outside", "p-aaaa=muse", "--outside", "nonsense"),
		],
	])("refuses %s, saying how to write it", (_name, args) => {
		expect(() => parseOutsides(args)).toThrow(
			/--outside needs a person id and a mailbox agent, like p-4k2m=muse/,
		);
	});

	test("refuses the same person twice", () => {
		expect(() =>
			parseOutsides(
				argv("--outside", "p-aaaa=muse", "--outside", "p-aaaa=grokbot"),
			),
		).toThrow(/p-aaaa is given more than once/);
	});

	test("refuses the same mailbox agent for two people, since they would share one queue", () => {
		expect(() =>
			parseOutsides(
				argv("--outside", "p-aaaa=muse", "--outside", "p-bbbb=muse"),
			),
		).toThrow(/muse is given for more than one person.*share one queue/);
	});
});

describe("pollSecondsFor", () => {
	test("grokbot is checked every 2 seconds, agents that poll every 15", () => {
		expect(pollSecondsFor("grokbot")).toBe(2);
		expect(pollSecondsFor("muse")).toBe(15);
	});

	test("--poll-seconds overrides both", () => {
		expect(pollSecondsFor("grokbot", 5)).toBe(5);
		expect(pollSecondsFor("muse", 3)).toBe(3);
	});
});
