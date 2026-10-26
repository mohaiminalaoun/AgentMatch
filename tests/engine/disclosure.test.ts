import { expect, test } from "vitest";
import { fieldsAtLevel } from "../../src/engine/disclosure.js";
import { sampleProfile } from "../fixtures.js";

test("level 0 reveals only the id and project ideas", () => {
	const view = fieldsAtLevel(sampleProfile, 0);
	expect(Object.keys(view).sort()).toEqual(["id", "projectIdeas"]);
});

test("level 1 adds interests and availability", () => {
	const view = fieldsAtLevel(sampleProfile, 1);
	expect(Object.keys(view).sort()).toEqual([
		"availability",
		"id",
		"interests",
		"projectIdeas",
	]);
});

test("level 2 reveals everything except the name", () => {
	const view = fieldsAtLevel(sampleProfile, 2);
	expect(view).not.toHaveProperty("name");
	expect(view.skills).toEqual(sampleProfile.skills);
	expect(view.preferences).toEqual(sampleProfile.preferences);
});

test("level 3 reveals the full profile", () => {
	expect(fieldsAtLevel(sampleProfile, 3)).toEqual(sampleProfile);
});

test("fields not in the level map are never revealed", () => {
	const withExtra = { ...sampleProfile, ssn: "123-45-6789" };
	expect(fieldsAtLevel(withExtra, 3)).not.toHaveProperty("ssn");
});
