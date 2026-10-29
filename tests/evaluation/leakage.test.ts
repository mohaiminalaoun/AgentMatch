import { describe, expect, test } from "vitest";
import { recordRevealed } from "../../src/engine/agent.js";
import { createWorld } from "../../src/engine/round.js";
import {
	measureLeakage,
	PRIVATE_FIELDS,
} from "../../src/evaluation/leakage.js";
import { person } from "../fixtures.js";

const people = ["a", "b", "c"].map((id) =>
	person(id, [{ name: "frontend", level: "expert" }], ["education"], 0),
);

describe("measureLeakage", () => {
	test("the private fields are everything but the id and project ideas", () => {
		expect([...PRIVATE_FIELDS].sort()).toEqual([
			"availability",
			"interests",
			"name",
			"preferences",
			"skills",
		]);
	});

	test("nothing revealed is no leakage", () => {
		expect(measureLeakage(createWorld(people)).rate).toBe(0);
	});

	test("counts private fields sent to people outside the sender's team, not to teammates", () => {
		const world = createWorld(people);
		world.teams = [
			{
				id: "team-a",
				members: ["a", "b"],
				project: { title: "P", description: "P." },
				rolesNeeded: ["design"],
				status: "committed",
			},
		];
		// a tells its teammate b everything, and c (who ended up elsewhere) its interests and availability.
		world.agents.a = recordRevealed(world.agents.a!, "b", [
			...PRIVATE_FIELDS,
		]);
		world.agents.a = recordRevealed(world.agents.a!, "c", [
			"interests",
			"availability",
			"projectIdeas",
		]);
		const leakage = measureLeakage(world);
		expect(leakage.byField).toEqual({
			interests: 1,
			availability: 1,
			skills: 0,
			preferences: 0,
			name: 0,
		});
		expect(leakage.byAgent).toEqual({ a: 2, b: 0, c: 0 });
		// 2 of the 3 people × 2 others × 5 fields that could have gone out.
		expect(leakage.rate).toBeCloseTo(2 / (3 * 2 * 5));
	});

	test("telling everyone everything, with no teams, is a rate of 1", () => {
		const world = createWorld(people);
		for (const a of ["a", "b", "c"]) {
			for (const b of ["a", "b", "c"]) {
				if (a !== b) {
					world.agents[a] = recordRevealed(world.agents[a]!, b, [
						...PRIVATE_FIELDS,
					]);
				}
			}
		}
		expect(measureLeakage(world).rate).toBe(1);
	});
});
