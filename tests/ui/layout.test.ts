import { describe, it, expect } from "vitest";
import { groupAgents } from "../../src/ui/web/layout.js";
describe("grouped agent layout", () => {
	it("keeps every team member and its label inside the team circle", () => {
		for (const size of [2, 3, 4, 6, 8, 12]) {
			const ids = Array.from({ length: size }, (_, i) => `p${i}`);
			const { placements, circles } = groupAgents(
				ids,
				[{ id: "team", members: ids }],
				ids[0]!,
			);
			const circle = circles[0]!;
			for (const id of ids) {
				const p = placements[id]!;
				const halfWidth = Math.max(47 * p.scale, 32);
				for (const x of [p.x - halfWidth, p.x + halfWidth])
					for (const y of [
						p.y - 62 * p.scale,
						p.y + 55 * p.scale + 16,
					])
						expect(
							Math.hypot(x - circle.x, y - circle.y),
						).toBeLessThan(circle.radius);
			}
			expect(placements[ids[0]!]!.scale).toBeGreaterThan(
				placements[ids[1]!]!.scale,
			);
		}
	});
	it("separates teams, keeps unplaced agents out of team circles, and places everyone once", () => {
		const ids = Array.from({ length: 30 }, (_, i) => `p${i}`);
		const teams = Array.from({ length: 5 }, (_, i) => ({
			id: `t${i}`,
			members: ids.slice(i * 4, i * 4 + 4),
		}));
		const { placements, circles, height } = groupAgents(ids, teams, "p0");
		expect(Object.keys(placements)).toHaveLength(30);
		for (const [i, a] of circles.entries())
			for (const b of circles.slice(i + 1))
				expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(
					a.radius + b.radius,
				);
		for (const id of ids.slice(20))
			for (const circle of circles.filter(
				(c) => !c.id.startsWith("open-"),
			))
				expect(
					Math.hypot(
						placements[id]!.x - circle.x,
						placements[id]!.y - circle.y,
					),
				).toBeGreaterThan(circle.radius + 30);
		for (const p of Object.values(placements))
			expect(p.y + 70).toBeLessThan(height);
	});
	it("has no overlapping character or label bounds within a group", () => {
		const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
		const { placements } = groupAgents(
			ids,
			[{ id: "team", members: ids }],
			"p0",
		);
		const points = Object.values(placements);
		for (const [i, a] of points.entries())
			for (const b of points.slice(i + 1)) {
				const separatedX =
					Math.abs(a.x - b.x) >=
					Math.max(47 * a.scale, 32) + Math.max(47 * b.scale, 32);
				const separatedY =
					Math.abs(a.y - b.y) >=
					62 * Math.max(a.scale, b.scale) +
						55 * Math.max(a.scale, b.scale) +
						16;
				expect(separatedX || separatedY).toBe(true);
			}
	});
});
