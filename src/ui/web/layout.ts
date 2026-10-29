export type Point = { x: number; y: number };

export type AgentPlacement = Point & { scale: number };
export type GroupPlacement = Point & {
	id: string;
	radius: number;
	titleY: number;
	members: string[];
};
/** Place groups first; every member is packed within its own group's circle. */
export function groupAgents(
	ids: readonly string[],
	teams: readonly { id: string; members: readonly string[] }[],
	selected: string,
) {
	const assigned = new Set(teams.flatMap((t) => [...t.members]));
	const groups = teams
		.map((t) => ({
			id: t.id,
			members: t.members.filter((id) => ids.includes(id)),
		}))
		.filter((t) => t.members.length);
	const exploring = ids.filter((id) => !assigned.has(id));
	// Split the open board into manageable groups rather than shrinking a large crowd indefinitely.
	for (let i = 0; i < exploring.length; i += 6)
		groups.push({ id: `open-${i}`, members: exploring.slice(i, i + 6) });
	const columns = 2,
		cellWidth = 400,
		cellHeight = 390,
		radius = 158;
	const placements: Record<string, AgentPlacement> = {};
	const circles: GroupPlacement[] = [];
	for (const [index, group] of groups.entries()) {
		const center = {
			x: 230 + (index % columns) * cellWidth,
			y: 245 + Math.floor(index / columns) * cellHeight,
		};
		const cols = Math.min(3, Math.ceil(Math.sqrt(group.members.length)));
		const rows = Math.ceil(group.members.length / cols);
		// A square inscribed in the circle leaves room for labels at the corners.
		const inner = 214;
		const base = Math.min(
			1,
			(inner / cols - 12) / 94,
			(inner / rows - 14) / 130,
		);
		group.members.forEach((id, j) => {
			const row = Math.floor(j / cols),
				count = Math.min(cols, group.members.length - row * cols);
			const x =
				center.x + ((j % cols) - (count - 1) / 2) * (inner / cols);
			const y = center.y + (row - (rows - 1) / 2) * (inner / rows);
			const scale = base * (id === selected ? 1 : 0.88);
			placements[id] = { x, y, scale };
		});
		circles.push({
			...center,
			id: group.id,
			radius,
			titleY: center.y + radius + 25,
			members: group.members,
		});
	}
	return {
		placements,
		circles,
		height: Math.max(
			570,
			Math.ceil(groups.length / columns) * cellHeight + 120,
		),
	};
}
