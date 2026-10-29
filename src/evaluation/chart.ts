// The privacy vs. quality chart: each method's per-person team quality against its leakage, as a
// standalone SVG (for the README, the video, and the web view). Agents are the one highlighted series; the
// baselines are context in gray. A filled dot needs no trusted party; a ring means one is needed.
import type { MethodResult } from "./evaluate.js";

export type ChartInput = {
	rows: readonly MethodResult[];
	// The agents' per-person quality and leakage for each seed, drawn as faint dots around their mean.
	agentSeeds: readonly { seed: number; overall: number; leakage: number }[];
	people: number;
	seeds: readonly number[];
	model: string;
	date: string;
};

const WIDTH = 780;
const HEIGHT = 500;
const PLOT = { left: 72, right: 720, top: 122, bottom: 412 };
// The leakage axis starts below 0 so methods at 0% (the central matchers) have room for labels on their left.
const X_MIN = -0.28;

// Light and dark values for each role, from the reference palette; the SVG switches with the viewer's scheme.
const STYLE = `
	svg { --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781; --grid: #e1e0d9; --axis: #c3c2b7; --agents: #2a78d6; --context: #898781; }
	@media (prefers-color-scheme: dark) {
		svg { --surface: #1a1a19; --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781; --grid: #2c2c2a; --axis: #383835; --agents: #3987e5; --context: #898781; }
	}
	text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
	.title { font-size: 17px; font-weight: 600; fill: var(--ink); }
	.subtitle { font-size: 12.5px; fill: var(--ink-2); }
	.tick { font-size: 11px; fill: var(--muted); font-variant-numeric: tabular-nums; }
	.axis-label { font-size: 12px; fill: var(--ink-2); }
	.label { font-size: 12.5px; fill: var(--ink); }
	.label-2 { font-size: 11.5px; fill: var(--ink-2); }
	.dim { fill: var(--ink-2); }
	.note { font-size: 11px; fill: var(--muted); }
`;

// Escapes text for SVG.
function esc(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

// A dot for a method: filled if no trusted party is needed, a ring if one is; 2px surface ring either way.
function dot(
	x: number,
	y: number,
	r: number,
	color: string,
	central: boolean,
	title: string,
): string {
	const mark = central
		? `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--surface)" stroke="${color}" stroke-width="2.5"/>`
		: `<circle cx="${x}" cy="${y}" r="${r + 2}" fill="var(--surface)"/><circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
	// The invisible circle is a larger hover target carrying the tooltip.
	return `<g>${mark}<circle cx="${x}" cy="${y}" r="${r + 8}" fill="transparent"><title>${esc(title)}</title></circle></g>`;
}

export function chartSvg(input: ChartInput): string {
	const { rows } = input;
	const yMax =
		Math.ceil(
			Math.max(...rows.map((r) => Math.max(r.overall, r.score))) * 10 + 1,
		) / 10;
	const x = (leakage: number) =>
		PLOT.left +
		((leakage - X_MIN) / (1 - X_MIN)) * (PLOT.right - PLOT.left);
	const y = (quality: number) =>
		PLOT.bottom - (quality / yMax) * (PLOT.bottom - PLOT.top);
	const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
	const parts: string[] = [];

	// Grid and axes: recessive hairlines.
	for (let q = 0; q <= yMax + 1e-9; q += 0.1) {
		const yy = y(q).toFixed(1);
		parts.push(
			`<line x1="${x(0)}" x2="${PLOT.right}" y1="${yy}" y2="${yy}" stroke="${q === 0 ? "var(--axis)" : "var(--grid)"}" stroke-width="1"/>`,
			`<text class="tick" x="${PLOT.right + 8}" y="${yy}" dy="0.35em">${q.toFixed(1)}</text>`,
		);
	}
	for (let l = 0; l <= 1 + 1e-9; l += 0.2) {
		const xx = x(l).toFixed(1);
		parts.push(
			`<line x1="${xx}" x2="${xx}" y1="${PLOT.top}" y2="${PLOT.bottom}" stroke="${l === 0 ? "var(--axis)" : "var(--grid)"}" stroke-width="1"/>`,
			`<text class="tick" x="${xx}" y="${PLOT.bottom + 18}" text-anchor="middle">${Math.round(l * 100)}%</text>`,
		);
	}
	parts.push(
		`<text class="axis-label" x="${(x(0) + PLOT.right) / 2}" y="${PLOT.bottom + 42}" text-anchor="middle">Leakage: private profile fields that reached someone outside their own team →</text>`,
		`<text class="axis-label" transform="translate(${PLOT.left - 40} ${(PLOT.top + PLOT.bottom) / 2}) rotate(-90)" text-anchor="middle">Team quality per person (0 if left without a team) →</text>`,
	);

	// Baselines: gray context, labeled directly.
	for (const row of rows.filter((r) => r.method !== "agents")) {
		const cx = x(row.leakage);
		const cy = y(row.overall);
		// Labels at 0% go on the left, clear of the agents just to the right; so do labels near the right edge,
		// clear of the axis numbers there.
		const left = row.leakage < 0.05 || row.leakage > 0.7;
		parts.push(
			dot(
				cx,
				cy,
				6,
				"var(--context)",
				row.central,
				`${row.method}: quality ${row.overall.toFixed(3)} per person · leakage ${pct(row.leakage)} · ${row.central ? "needs a trusted party" : "no trusted party"}`,
			),
			`<text class="label" x="${left ? cx - 14 : cx + 14}" y="${cy}" text-anchor="${left ? "end" : "start"}" dy="0.35em">${esc(row.method)} <tspan class="dim">${row.overall.toFixed(2)}</tspan></text>`,
		);
	}

	// Agents: each seed faintly, the gap between teams that formed and everyone, then the mean on top.
	const agents = rows.find((r) => r.method === "agents");
	if (agents) {
		for (const s of input.agentSeeds) {
			parts.push(
				`<circle cx="${x(s.leakage)}" cy="${y(s.overall)}" r="4" fill="var(--agents)" fill-opacity="0.3"><title>${esc(`agents, seed ${s.seed}: quality ${s.overall.toFixed(3)} per person · leakage ${pct(s.leakage)}`)}</title></circle>`,
			);
		}
		const ax = x(agents.leakage);
		const formed = y(agents.score);
		const all = y(agents.overall);
		parts.push(
			`<line x1="${ax}" x2="${ax}" y1="${formed + 7}" y2="${all - 9}" stroke="var(--agents)" stroke-width="2" stroke-dasharray="4 4"/>`,
			dot(
				ax,
				formed,
				6,
				"var(--agents)",
				true,
				`agents, teams that formed: quality ${agents.score.toFixed(3)}`,
			).replace(
				'stroke-width="2.5"',
				'stroke-width="2.5" stroke-dasharray="3 2"',
			),
			`<text class="label-2" x="${ax + 14}" y="${formed}" dy="0.35em">teams that formed ${agents.score.toFixed(2)}</text>`,
			`<text class="label-2" x="${ax + 14}" y="${(formed + all) / 2}" dy="0.35em">${Math.round((1 - agents.placed) * 100)}% of people left without a team</text>`,
			dot(
				ax,
				all,
				7,
				"var(--agents)",
				false,
				`agents: quality ${agents.overall.toFixed(3)} per person · leakage ${pct(agents.leakage)} · ${Math.round(agents.placed * 100)}% placed · no trusted party`,
			),
			`<text class="label" x="${ax + 16}" y="${all}" dy="0.35em" font-weight="600">agents <tspan class="dim" font-weight="400">${agents.overall.toFixed(2)} · ${pct(agents.leakage)} leaked</tspan></text>`,
		);
	}

	// Legend: one row under the subtitle. Shape (not just color) says whether a trusted party is needed.
	const ly = 86;
	const items: [number, string, string][] = [
		[0, `<circle r="6" fill="var(--agents)"/>`, "Agents"],
		[86, `<circle r="6" fill="var(--context)"/>`, "Baselines"],
		[186, `<circle r="6" fill="var(--ink-2)"/>`, "No trusted party"],
		[
			324,
			`<circle r="6" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="2.5"/>`,
			"Needs a trusted party, who sees every profile",
		],
		[
			620,
			`<circle r="4" fill="var(--agents)" fill-opacity="0.3"/>`,
			"One seed",
		],
	];
	for (const [dx, mark, text] of items) {
		const lx = PLOT.left - 48 + 6 + dx;
		parts.push(
			`<g transform="translate(${lx} ${ly})">${mark}</g><text class="label-2" x="${lx + 12}" y="${ly}" dy="0.35em">${text}</text>`,
		);
	}

	const title = "Team quality vs. privacy leakage";
	const subtitle = `${input.people} generated people · seeds ${input.seeds.join(", ")} · up and to the left is better`;
	const note = `Quality: skill coverage, shared interests, and overlapping hours (0–1). Source: npm run eval:agents, ${input.date.slice(0, 10)}, ${input.model}.`;
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-labelledby="chart-title chart-desc">`,
		`<title id="chart-title">${title}</title>`,
		`<desc id="chart-desc">${esc(rows.map((r) => `${r.method}: per-person quality ${r.overall.toFixed(3)}, leakage ${pct(r.leakage)}, ${r.central ? "needs a trusted party" : "no trusted party"}`).join("; "))}.</desc>`,
		`<style>${STYLE}</style>`,
		`<rect width="${WIDTH}" height="${HEIGHT}" fill="var(--surface)"/>`,
		`<text class="title" x="${PLOT.left - 48}" y="36">${title}</text>`,
		`<text class="subtitle" x="${PLOT.left - 48}" y="58">${esc(subtitle)}</text>`,
		...parts,
		`<text class="note" x="${PLOT.left - 48}" y="${HEIGHT - 14}">${esc(note)}</text>`,
		"</svg>",
	].join("\n");
}
