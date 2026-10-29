import { describe, expect, test } from "vitest";
import {
	checkDisclosure,
	checkThirdParty,
	draftOf,
	fieldsMentioned,
} from "../../src/engine/gate.js";
import type { Profile } from "../../src/engine/profile.js";

// Ben, as described in the reliability runs: a backend engineer who wants to start a climate-change non-profit.
const ben: Profile = {
	id: "p2",
	name: "Ben",
	skills: [
		{ name: "backend", level: "expert" },
		{ name: "ml", level: "beginner" },
	],
	interests: ["climate", "open source"],
	projectIdeas: [
		{
			title: "Climate-change non-profit",
			description: "A non-profit that helps cities cut emissions.",
		},
	],
	availability: { hoursPerWeek: 20, utcOffset: -5 },
	preferences: {
		minTeamSize: 2,
		maxTeamSize: 4,
		preferredRoles: ["backend"],
	},
};

// The fields a list of violations names, sorted.
const fields = (violations: { field: string }[]) =>
	[...new Set(violations.map((v) => v.field))].sort();

const reason = (text: string) => ({ texts: { reason: text } });

describe("the real leaked decline reasons", () => {
	test("the level-2 skill leaks are blocked at level 0", () => {
		const leaked = [
			"My human is a backend engineer who wants to start a climate-change non-profit, which does not align with afreelancer invoicing startup.",
			"Not aligned: my client is a backend engineer who wants to start a climate-change non-profit, not a freelancer invoicing startup.",
			"Proposal is a for-profit invoicing app, while principal is a backend engineer who wants to start a climate-change non-profit.",
		];
		for (const text of leaked) {
			const violations = checkDisclosure(ben, 0, reason(text));
			expect(violations).toContainEqual({
				field: "skills",
				where: "reason",
				match: "backend",
			});
		}
	});

	test("reasons that only repeat the public project idea pass the gate", () => {
		const legal = [
			"Proposal is a for-profit invoicing startup, not a climate-change non-profit.",
			"Proposal for a freelancer invoicing startup does not align with goal of starting a climate-change non-profit.",
		];
		for (const text of legal) {
			expect(checkDisclosure(ben, 0, reason(text))).toEqual([]);
		}
	});

	test("the same skill leak is allowed once the level reaches skills", () => {
		const text = "My human is a backend engineer.";
		expect(checkDisclosure(ben, 2, reason(text))).toEqual([]);
	});
});

describe("free text", () => {
	test("a value that's already public through a lower field isn't a leak", () => {
		// "climate" is an interest (level 1) but also in the project idea (level 0).
		expect(
			checkDisclosure(ben, 0, reason("I care about climate.")),
		).toEqual([]);
	});

	test("an interest that isn't public is blocked below level 1", () => {
		const draft = reason("We love open source here.");
		expect(fields(checkDisclosure(ben, 0, draft))).toEqual(["interests"]);
		expect(checkDisclosure(ben, 1, draft)).toEqual([]);
	});

	test("matches whole words only, so the skill ml doesn't match html", () => {
		expect(
			checkDisclosure(ben, 0, reason("We need HTML and CSS help.")),
		).toEqual([]);
		expect(
			fields(checkDisclosure(ben, 0, reason("I know some ML."))),
		).toEqual(["skills"]);
	});

	test("ignores case", () => {
		expect(
			fields(checkDisclosure(ben, 0, reason("BACKEND person here"))),
		).toEqual(["preferences", "skills"]);
	});

	test("common synonyms of a skill count", () => {
		const violations = checkDisclosure(
			ben,
			0,
			reason("I mostly do server-side work."),
		);
		expect(violations).toContainEqual({
			field: "skills",
			where: "reason",
			match: "server-side",
		});
	});

	test("a multi-word synonym needs its space, so it isn't counted twice", () => {
		expect(checkDisclosure(ben, 0, reason("A backend tool."))).toEqual([
			{ field: "skills", where: "reason", match: "backend" },
			{ field: "preferences", where: "reason", match: "backend" },
		]);
		expect(
			checkDisclosure(ben, 0, reason("I like back   end work.")).map(
				(v) => v.match,
			),
		).toEqual(["back end", "back end"]);
	});

	test("the name is blocked until level 3", () => {
		const draft = reason("Ben would rather not.");
		expect(fields(checkDisclosure(ben, 2, draft))).toEqual(["name"]);
		expect(checkDisclosure(ben, 3, draft)).toEqual([]);
	});

	test("availability phrases are blocked below level 1", () => {
		expect(
			fields(checkDisclosure(ben, 0, reason("I have 20 hours a week."))),
		).toEqual(["availability"]);
		expect(
			fields(checkDisclosure(ben, 0, reason("I'm on UTC-5."))),
		).toEqual(["availability"]);
		expect(checkDisclosure(ben, 1, reason("I'm on UTC-5."))).toEqual([]);
	});

	test("every text part is checked, and missing parts are skipped", () => {
		const violations = checkDisclosure(ben, 0, {
			texts: {
				pitch: "A backend tool.",
				reason: undefined,
				note: "Hi, Ben here.",
			},
		});
		expect(violations.map((v) => v.where).sort()).toEqual([
			"note",
			"pitch",
			"pitch",
		]);
	});

	test("a harmless message passes", () => {
		expect(checkDisclosure(ben, 0, reason("Not a fit right now."))).toEqual(
			[],
		);
	});
});

describe("structured shared data", () => {
	test("a field above the level is blocked", () => {
		const violations = checkDisclosure(ben, 1, {
			texts: {},
			shared: { skills: ben.skills },
		});
		expect(violations).toEqual([
			{ field: "skills", where: "shared", match: "needs level 2" },
		]);
	});

	test("fields within the level pass when they match the profile", () => {
		expect(
			checkDisclosure(ben, 1, {
				texts: {},
				shared: {
					interests: ben.interests,
					availability: ben.availability,
				},
			}),
		).toEqual([]);
	});

	test("a value that doesn't match the real profile is blocked", () => {
		const violations = checkDisclosure(ben, 1, {
			texts: {},
			shared: { interests: ["gaming"] },
		});
		expect(violations).toEqual([
			{
				field: "interests",
				where: "shared",
				match: "doesn't match the profile",
			},
		]);
	});

	test("keys that aren't profile fields are blocked", () => {
		const violations = checkDisclosure(ben, 3, {
			texts: {},
			shared: { salary: 100 } as Partial<Profile>,
		});
		expect(violations).toEqual([
			{ field: "salary", where: "shared", match: "not a profile field" },
		]);
	});
});

describe("draftOf", () => {
	test("a decline has no text to check", () => {
		expect(draftOf({ decision: "decline" })).toEqual({ texts: {} });
	});

	test("a counter's or proposal's pitch and roles are the text to check", () => {
		const terms = { pitch: "A climate app.", rolesNeeded: ["frontend"] };
		const texts = { pitch: "A climate app.", roles: "frontend" };
		expect(draftOf({ decision: "counter", ...terms })).toEqual({ texts });
		expect(draftOf(terms)).toEqual({ texts });
	});

	test("an accept has no text", () => {
		expect(draftOf({ decision: "accept" })).toEqual({ texts: {} });
	});
});

describe("fieldsMentioned", () => {
	test("lists every field a text mentions, allowed or not", () => {
		expect(
			fieldsMentioned(
				ben,
				"Climate-change non-profit, built by a backend engineer named Ben.",
			),
		).toEqual(["projectIdeas", "skills", "preferences", "name"]);
	});

	test("an interest that's also in a public project idea counts as the project idea only", () => {
		expect(fieldsMentioned(ben, "Something for climate.")).toEqual([]);
		expect(fieldsMentioned(ben, "We love open source.")).toEqual([
			"interests",
		]);
	});

	test("a pitch built from the project idea mentions only the project idea", () => {
		const idea = ben.projectIdeas[0]!;
		expect(
			fieldsMentioned(ben, `${idea.title}: ${idea.description}`),
		).toEqual(["projectIdeas"]);
	});

	test("an unrelated text mentions nothing", () => {
		expect(fieldsMentioned(ben, "Not a fit right now.")).toEqual([]);
	});
});

describe("roles as a side channel", () => {
	// Nia's real counter from the live run, checked against Ben's profile: he does backend.
	const roles = (rolesNeeded: string[]) =>
		draftOf({
			decision: "counter",
			pitch: "AI note-taking app with dyslexia-friendly tools.",
			rolesNeeded,
		});

	test("listing your own skill as a role needed is blocked below level 2", () => {
		const violations = checkDisclosure(
			ben,
			0,
			roles(["frontend", "design", "product", "backend"]),
		);
		expect(violations).toContainEqual({
			field: "skills",
			where: "roles",
			match: "backend",
		});
	});

	test("the same roles pass once skills are shared", () => {
		expect(
			checkDisclosure(
				ben,
				2,
				roles(["frontend", "design", "product", "backend"]),
			),
		).toEqual([]);
	});

	test("a synonym of your own skill is caught in the roles list too", () => {
		expect(
			fields(checkDisclosure(ben, 0, roles(["server-side"]))),
		).toContain("skills");
	});

	test("roles you don't have pass", () => {
		expect(checkDisclosure(ben, 0, roles(["frontend", "design"]))).toEqual(
			[],
		);
	});

	test("a role that's public through your project idea passes", () => {
		const withIdea = {
			...ben,
			projectIdeas: [
				{ title: "An ML tutor", description: "ML for students." },
			],
		};
		expect(checkDisclosure(withIdea, 0, roles(["ml"]))).toEqual([]);
	});
});

describe("checkThirdParty", () => {
	const other = {
		name: "Zed Quill",
		skills: [{ name: "ml", level: "expert" as const }],
		interests: ["falconry"],
	};

	test("flags another person's name, skill (with synonyms), or interest", () => {
		const violations = checkThirdParty(
			{ pitch: "Zed Quill's machine learning tool for falconry." },
			[other],
			"",
		);
		expect(violations.map((v) => v.match).sort()).toEqual([
			"Zed Quill",
			"falconry",
			"machine learning",
		]);
	});

	test("a term the recipient could already see isn't a leak", () => {
		expect(
			checkThirdParty(
				{ pitch: "A falconry app." },
				[other],
				JSON.stringify({ interests: ["falconry"] }),
			),
		).toEqual([]);
	});

	test("only the named text parts are searched", () => {
		expect(checkThirdParty({ pitch: "A bird app." }, [other], "")).toEqual(
			[],
		);
	});
});
