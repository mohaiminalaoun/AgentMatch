import { describe, expect, test } from "vitest";
import {
	containsPersonalClaim,
	undisclosedProjectText,
} from "../../src/engine/project-context.js";

describe("already-shared project language", () => {
	test("removes repeated project passages while leaving new words for disclosure checks", () => {
		const source =
			"Satellite flood alerts and an ML-tagged photo log with export.";
		const result = undisclosedProjectText(
			"Satellite flood alerts and an ML-tagged photo log with export via a script. Secret falconry expertise.",
			[source],
		);
		expect(result).not.toContain("ML");
		expect(result).toContain("Secret falconry expertise");
	});
	test("one previously used skill word does not authorize unrelated new claims", () => {
		expect(
			undisclosedProjectText("ML expertise for an unrelated scanner.", [
				"An ML-tagged photo log.",
			]),
		).toContain("ML expertise");
	});
	test("exact unchanged fields remain shared even when short", () => {
		expect(
			undisclosedProjectText("Health practice", ["Health practice"]),
		).toBe("");
	});
	test("Unicode offsets do not mask newly added private text", () => {
		const result = undisclosedProjectText(
			"🧠 ML tagging for photos. Private frontend experience.",
			["ML tagging for photos."],
		);
		expect(result).not.toContain("ML tagging");
		expect(result).toContain("Private frontend experience");
	});
	test.each([
		"I have ML experience.",
		"My human studies health science.",
		"The other member has ML experience.",
		"Their research background helps.",
	])(
		"personal wording is not eligible for project-language exemptions: %s",
		(text) => {
			expect(containsPersonalClaim(text)).toBe(true);
		},
	);
});
