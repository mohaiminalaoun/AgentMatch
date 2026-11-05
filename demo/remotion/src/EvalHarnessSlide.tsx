import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import "./video.css";

/*
 * Data: results/baseline-*.json (synthetic people only, 20 people x seeds 1-5).
 *  - methods: baseline-after-groups.json -> eval.rows
 *  - judge: baseline-after-groups.json -> explain.all (2,047 claims over 254 calls)
 *  - regressions: baseline-2026-10-30.json (before) vs baseline-after-groups.json (after), same cases
 *  - trends: the five baselines in date order
 */

const PURPLE = "#5b4b9a";
const INK = "#2a2a3c";
const TEAL = "#28bbae";
const RED = "#c23b47";
const AMBER = "#d9961b";
const MUTE = "#8a86a3";

const METHODS = [
	{ name: "random", q: 0.34, leak: 0, central: true },
	{ name: "greedy", q: 0.546, leak: 0, central: true },
	{ name: "local search", q: 0.6, leak: 0, central: true },
	{ name: "broadcast", q: 0.6, leak: 0.874, central: false },
	{ name: "agents", q: 0.553, leak: 0.101, central: false },
];

const JUDGE = { calls: 254, claims: 2047, supported: 1976, unsupported: 61, contradicted: 10 };

const REG = [
	{ name: "role omission", before: 10, after: 0 },
	{ name: "join request", before: 4, after: 0 },
	{ name: "invented scheduling", before: 9, after: 0 },
	{ name: "headcount", before: 7, after: 0 },
	{ name: "misdescribed option", before: 0, after: 0 },
	{ name: "relabeled roles", before: 8, after: 2 },
];

const TRENDS = [
	{ label: "Claims supported ↑", unit: "%", better: "higher", vals: [90.7, 96.3, 96.2, 97.6, 96.5], lo: 88, hi: 100, color: TEAL },
	{ label: "Leakage ↓", unit: "%", better: "lower", vals: [14.8, 17.2, 12.3, 10.4, 10.1], lo: 8, hi: 18, color: RED },
	{ label: "People placed ↑", unit: "%", better: "higher", vals: [82, 63, 91, 88, 87], lo: 55, hi: 100, color: PURPLE },
];
const TICKS = ["Oct 30", "grounding", "fix", "roles", "groups"];

// timeline (30 fps)
const T = {
	chart: 40,
	pts: [90, 118, 146, 220, 300], // random, greedy, local search, broadcast, agents
	callA: 170, callB: 250, callC: 340, gap: 400,
	cards: 600, card2: 770, card3: 940,
	end: 1180,
};
export const EVAL_HARNESS_FRAMES = 1290;

const CAPTIONS = [
	{ a: 50, b: 214, text: "Same 20 synthetic people, five seeds, five ways to form teams." },
	{ a: 220, b: 392, text: "Central methods need a trusted party that sees everyone's data. Broadcasting leaks it." },
	{ a: 400, b: 560, text: "Agents keep 92% of the best quality with about 9 times less leakage and no trusted party." },
	{ a: 610, b: 764, text: "A judge model checks each claim in an agent's private reasoning against its own prompt." },
	{ a: 778, b: 934, text: "Every reasoning failure seen in the pilot became a replayable test." },
	{ a: 948, b: 1170, text: "Each change is compared with the last frozen baseline." },
	{ a: 1190, b: 1290, text: "Synthetic people only. Aggregates only, no private text." },
];

const range = (f: number, a: number, b: number, e = Easing.out(Easing.cubic)) =>
	interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });
const both = (f: number, a: number, b: number) => Math.min(range(f, a, a + 14), 1 - range(f, b - 12, b, Easing.in(Easing.cubic)));

const css = `
.ev { font-family: "DM Sans", sans-serif; color: ${INK}; background: #f6f5fc;
  background-image: radial-gradient(#d9d5ee 2.5px, transparent 2.5px); background-size: 40px 40px; }
.ev .eyebrow { font-size: 24px; letter-spacing: .14em; text-transform: uppercase; color: ${PURPLE}; font-weight: 700; }
.ev .h1 { color: ${INK}; font-size: 76px; line-height: 1.05; font-weight: 600; letter-spacing: -.02em; }
.ev .word { display: inline-block; margin-right: .26em; }
.card { position: absolute; background: #fff; border: 2px solid #e4def7; border-radius: 28px; padding: 30px 34px;
  box-shadow: 0 34px 60px -40px rgba(60,40,120,.4); }
.card h3 { margin: 0; font-size: 36px; font-weight: 700; }
.card .sub { font-size: 21px; font-weight: 600; color: #7a7592; margin: 6px 0 22px; line-height: 1.3; }
.mono { font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; }
.callout { position: absolute; width: 560px; border-radius: 22px; background: #fff; border: 2px solid #e4def7; padding: 18px 24px; font-size: 26px; line-height: 1.3; font-weight: 600; }
.callout b { font-weight: 800; }
.cap { position: absolute; left: 110px; right: 110px; text-align: center; font-size: 34px; font-weight: 600; color: #5d5878; }
`;

function Words({ text, start }: { text: string; start: number }) {
	const f = useCurrentFrame();
	return (
		<div className="h1">
			{text.split(" ").map((w, i) => {
				const p = range(f, start + i * 5, start + 16 + i * 5);
				return (
					<span key={i} className="word" style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, filter: `blur(${(1 - p) * 10}px)` }}>
						{w}
					</span>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------- scatter
const CX0 = 430, CX1 = 1130, CY0 = 840, CY1 = 290;
const px = (leak: number) => CX0 + leak * (CX1 - CX0);
const py = (q: number) => CY0 - ((q - 0.3) / 0.35) * (CY0 - CY1);

function Scatter() {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	const axes = range(f, T.chart, T.chart + 24);
	const best = METHODS[2]!, agents = METHODS[4]!, bc = METHODS[3]!;
	const gap = range(f, T.gap, T.gap + 30);
	return (
		<svg width="1920" height="1080" style={{ position: "absolute", left: 0, top: 0 }} aria-hidden="true">
			<g opacity={axes}>
				{[0.3, 0.4, 0.5, 0.6].map((q) => (
					<g key={q}>
						<line x1={180} x2={CX1} y1={py(q)} y2={py(q)} stroke="#e4def7" strokeWidth="2" />
						<text x={165} y={py(q) + 8} textAnchor="end" fontSize="22" fontWeight="600" fill={MUTE} className="mono">{q.toFixed(1)}</text>
					</g>
				))}
				{[0, 0.25, 0.5, 0.75, 1].map((l) => (
					<text key={l} x={px(l)} y={CY0 + 40} textAnchor="middle" fontSize="22" fontWeight="600" fill={MUTE} className="mono">{Math.round(l * 100)}%</text>
				))}
				<text x={(CX0 + CX1) / 2} y={CY0 + 84} textAnchor="middle" fontSize="26" fontWeight="700" fill={PURPLE}>Private fields reaching non-teammates →</text>
				<text transform={`translate(96 ${(CY0 + CY1) / 2}) rotate(-90)`} textAnchor="middle" fontSize="26" fontWeight="700" fill={PURPLE}>Team quality →</text>
				<text x={CX0 + 14} y={CY1 - 14} fontSize="22" fontWeight="700" fill={TEAL}>better ↖</text>
			</g>
			{/* gap bracket between agents and broadcast */}
			<g opacity={gap}>
				<line x1={px(agents.leak) + 24} x2={px(bc.leak) - 24} y1={py(agents.q) - 70} y2={py(agents.q) - 70} stroke={TEAL} strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" />
				<path d={`M${px(bc.leak) - 24} ${py(agents.q) - 70} l-14 -9 m14 9 l-14 9`} stroke={TEAL} strokeWidth="4" fill="none" strokeLinecap="round" />
				<text x={(px(agents.leak) + px(bc.leak)) / 2} y={py(agents.q) - 92} textAnchor="middle" fontSize="30" fontWeight="800" fill="#13766c">≈ 9× less leakage</text>
			</g>
			{METHODS.map((m, i) => {
				const at = T.pts[i]!;
				const s = spring({ frame: f - at, fps, config: { damping: 9, stiffness: 170, mass: 0.6 } });
				if (f < at) return null;
				const isAgent = m.name === "agents";
				const r = isAgent ? 20 : 15;
				const fill = isAgent ? TEAL : m.name === "broadcast" ? "#fff" : "#8b86a8";
				const stroke = m.name === "broadcast" ? RED : isAgent ? "#0f8d82" : "#8b86a8";
				const lx = m.name === "broadcast" ? px(m.leak) : m.central ? px(m.leak) - 36 : px(m.leak) + 36;
				const anchor = m.name === "broadcast" ? "middle" : m.central ? "end" : "start";
				const ly = m.name === "broadcast" ? py(m.q) + 52 : py(m.q) + 8;
				return (
					<g key={m.name} transform={`translate(${px(m.leak)} ${py(m.q)}) scale(${s}) translate(${-px(m.leak)} ${-py(m.q)})`}>
						{m.central && <circle cx={px(m.leak)} cy={py(m.q)} r={r + 11} fill="none" stroke="#8b86a8" strokeWidth="3" strokeDasharray="5 6" />}
						{isAgent && <circle cx={px(m.leak)} cy={py(m.q)} r={r + 12 + 5 * Math.sin(f / 8)} fill={TEAL} opacity=".18" />}
						<circle cx={px(m.leak)} cy={py(m.q)} r={r} fill={fill} stroke={stroke} strokeWidth="5" />
						<text x={lx} y={ly} textAnchor={anchor} fontSize={isAgent ? 32 : 26} fontWeight={isAgent ? 800 : 700} fill={isAgent ? "#0d6b62" : m.name === "broadcast" ? RED : "#5d5878"}>{m.name}</text>
					</g>
				);
			})}
			{/* legend for dashed rings */}
			<g opacity={range(f, T.pts[2]! + 20, T.pts[2]! + 40)}>
				<circle cx={CX0 + 190} cy={py(0.34) } r="13" fill="none" stroke="#8b86a8" strokeWidth="3" strokeDasharray="5 6" />
				<text x={CX0 + 220} y={py(0.34) + 8} fontSize="23" fontWeight="600" fill={MUTE}>needs a trusted central party</text>
			</g>
		</svg>
	);
}

const DEFS = [
	{ name: "random", def: "Deals people into teams like cards.", tag: "trusted party", kind: "central" },
	{ name: "greedy", def: "Builds one team at a time, adding the best fit.", tag: "trusted party", kind: "central" },
	{ name: "local search", def: "Starts from greedy, swaps people to raise the score.", tag: "trusted party", kind: "central" },
	{ name: "broadcast", def: "Local search's teams, but everyone sees every profile.", tag: "87% leak", kind: "broadcast" },
	{ name: "agents", def: "Private agents; the arena enforces what is shared.", tag: "10% leak", kind: "agents" },
] as const;

function Callouts() {
	const f = useCurrentFrame();
	const out = 1 - range(f, T.cards - 30, T.cards - 6);
	const note = range(f, T.callC + 30, T.callC + 50);
	return (
		<>
			{DEFS.map((d, i) => {
				const p = range(f, T.pts[i]!, T.pts[i]! + 18);
				const isAgent = d.kind === "agents";
				const col = d.kind === "broadcast" ? RED : isAgent ? TEAL : "#8b86a8";
				return (
					<div
						key={d.name}
						style={{
							position: "absolute", left: 1230, top: 290 + i * 98, width: 580, height: 84, borderRadius: 20,
							background: isAgent ? "#eaf8f5" : "#fff", border: `2px solid ${isAgent ? TEAL : "#e4def7"}`,
							padding: "10px 20px", opacity: p * out, transform: `translateX(${(1 - p) * 40}px)`,
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
							<span style={{ width: 18, height: 18, borderRadius: 9, flex: "none", background: d.kind === "broadcast" ? "#fff" : col, border: `4px solid ${col}`, boxSizing: "border-box" }} />
							<span style={{ fontSize: 27, fontWeight: 800, color: isAgent ? "#0d6b62" : INK }}>{d.name}</span>
							<span style={{ marginLeft: "auto", fontSize: 18, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: col }}>
								{d.kind === "central" ? "needs " + d.tag : d.tag}
							</span>
						</div>
						<div style={{ fontSize: 21, fontWeight: 600, color: "#6a6682", marginTop: 4, whiteSpace: "nowrap" }}>{d.def}</div>
					</div>
				);
			})}
			<div style={{ position: "absolute", left: 1230, top: 290 + 5 * 98 + 6, width: 580, fontSize: 24, fontWeight: 700, color: "#13766c", opacity: note * out, transform: `translateY(${(1 - note) * 12}px)` }}>
				Agents place 87% of people; the central methods place everyone.
			</div>
		</>
	);
}

// ---------------------------------------------------------------- cards
function JudgeCard() {
	const f = useCurrentFrame();
	const p = range(f, T.cards, T.cards + 22);
	const fill = range(f, T.cards + 20, T.cards + 90, Easing.inOut(Easing.cubic));
	const W = 480;
	const sup = (JUDGE.supported / JUDGE.claims) * W, uns = (JUDGE.unsupported / JUDGE.claims) * W, con = Math.max(6, (JUDGE.contradicted / JUDGE.claims) * W);
	const n = (v: number) => Math.round(v * fill).toLocaleString("en-US");
	return (
		<div className="card" style={{ left: 80, top: 280, width: 560, height: 640, opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
			<h3>Judge</h3>
			<div className="sub">Every claim in an agent's private reasoning, sorted against what its prompt said.</div>
			<div style={{ fontSize: 96, fontWeight: 700, letterSpacing: "-.03em", lineHeight: 1 }}>{n(JUDGE.claims)}</div>
			<div style={{ fontSize: 22, fontWeight: 600, color: MUTE, marginBottom: 24 }}>claims judged · {JUDGE.calls} calls</div>
			<div style={{ display: "flex", width: W, height: 34, borderRadius: 17, overflow: "hidden", background: "#e9e5f6" }}>
				<div style={{ width: sup * fill, background: TEAL }} />
				<div style={{ width: uns * fill, background: AMBER }} />
				<div style={{ width: con * fill, background: RED }} />
			</div>
			<div style={{ marginTop: 26, display: "grid", gap: 12, fontSize: 26, fontWeight: 600 }}>
				{[
					[TEAL, "supported", JUDGE.supported, `${((JUDGE.supported / JUDGE.claims) * 100).toFixed(1)}%`],
					[AMBER, "unsupported", JUDGE.unsupported, ""],
					[RED, "contradicted", JUDGE.contradicted, ""],
				].map(([c, l, v, extra], i) => (
					<div key={i} style={{ display: "flex", alignItems: "center", gap: 14, opacity: range(f, T.cards + 70 + i * 8, T.cards + 84 + i * 8) }}>
						<span style={{ width: 16, height: 16, borderRadius: 8, background: c as string }} />
						<span style={{ width: 170 }}>{l}</span>
						<span className="mono" style={{ fontWeight: 700 }}>{(v as number).toLocaleString("en-US")}</span>
						<span style={{ color: MUTE }}>{extra}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function RegressionCard() {
	const f = useCurrentFrame();
	const p = range(f, T.card2, T.card2 + 22);
	const total = (k: "before" | "after") => REG.reduce((s, r) => s + r[k], 0);
	return (
		<div className="card" style={{ left: 680, top: 280, width: 560, height: 640, opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
			<h3>Regression suite</h3>
			<div className="sub">Each failure seen in the pilot, replayed on the engine's real prompts. Failing runs of 10.</div>
			<div style={{ display: "grid", gap: 12 }}>
				{REG.map((r, i) => {
					const a = T.card2 + 26 + i * 9;
					const g = range(f, a, a + 26);
					return (
						<div key={r.name} style={{ opacity: range(f, a - 4, a + 8) }}>
							<div style={{ display: "flex", justifyContent: "space-between", fontSize: 23, fontWeight: 600 }}>
								<span>{r.name}</span>
								<span className="mono" style={{ fontWeight: 700 }}>
									<span style={{ color: RED }}>{r.before}</span> → <span style={{ color: r.after === 0 ? "#13766c" : AMBER }}>{r.after}</span>
								</span>
							</div>
							<div style={{ marginTop: 6, height: 9, borderRadius: 5, background: "#ece8f8", overflow: "hidden" }}>
								<div style={{ width: `${r.before * 10 * g}%`, height: "100%", background: RED, opacity: 0.85 }} />
							</div>
							<div style={{ marginTop: 4, height: 9, borderRadius: 5, background: "#ece8f8", overflow: "hidden" }}>
								<div style={{ width: `${r.after * 10 * g}%`, height: "100%", background: TEAL }} />
							</div>
						</div>
					);
				})}
			</div>
			<div style={{ marginTop: 18, fontSize: 25, fontWeight: 700, opacity: range(f, T.card2 + 90, T.card2 + 110) }}>
				<span style={{ color: RED }}>{total("before")} of 60</span> failing runs → <span style={{ color: "#13766c" }}>{total("after")} of 60</span>
			</div>
		</div>
	);
}

function TrendCard() {
	const f = useCurrentFrame();
	const p = range(f, T.card3, T.card3 + 22);
	const W = 440, H = 64;
	return (
		<div className="card" style={{ left: 1280, top: 280, width: 560, height: 640, opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
			<h3>Frozen baselines</h3>
			<div className="sub">Aggregates saved after each change, so the next one has something to beat. Arrows point to better.</div>
			{TRENDS.map((t, ti) => {
				const a = T.card3 + 24 + ti * 24;
				const g = range(f, a, a + 50, Easing.inOut(Easing.cubic));
				const pts = t.vals.map((v, i) => [(i / (t.vals.length - 1)) * W + 10, H - ((v - t.lo) / (t.hi - t.lo)) * H + 6] as const);
				const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
				const first = t.vals[0]!, last = t.vals[t.vals.length - 1]!;
				return (
					<div key={t.label} style={{ marginBottom: 14, opacity: range(f, a - 4, a + 10) }}>
						<div style={{ display: "flex", justifyContent: "space-between", fontSize: 23, fontWeight: 700 }}>
							<span>{t.label}</span>
							<span className="mono" style={{ whiteSpace: "nowrap", fontSize: 21 }}>{first}{t.unit} → <span style={{ color: t.color }}>{last}{t.unit}</span></span>
						</div>
						<svg width={W + 20} height={H + 14} style={{ overflow: "visible" }} aria-hidden="true">
							<path d={d} pathLength={1} fill="none" stroke={t.color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1" strokeDashoffset={1 - g} />
							{pts.map(([x, y], i) => (
								<circle key={i} cx={x} cy={y} r="6.5" fill="#fff" stroke={t.color} strokeWidth="4" opacity={g > i / (pts.length - 1) ? 1 : 0} />
							))}
						</svg>
					</div>
				);
			})}
			<div style={{ display: "flex", justifyContent: "space-between", width: W + 20, fontSize: 17, fontWeight: 700, color: MUTE, marginTop: 4 }}>
				{TICKS.map((t) => <span key={t}>{t}</span>)}
			</div>
		</div>
	);
}

export function EvalHarness() {
	const f = useCurrentFrame();
	const stageScatter = 1 - range(f, T.cards - 28, T.cards - 4);
	const showCards = f >= T.cards - 2;
	return (
		<AbsoluteFill className="ev app-insert">
			<style>{css}</style>
			<div style={{ position: "absolute", left: 110, top: 52, opacity: range(f, 0, 14) }}>
				<div className="eyebrow">Evaluation / {f < T.cards ? "Privacy vs. quality" : "The harness"}</div>
			</div>
			<div style={{ position: "absolute", left: 110, top: 96 }}>
				<Words text="Measured, not asserted" start={6} />
			</div>

			<div style={{ opacity: stageScatter }}>
				{f < T.cards && <Scatter />}
				<Callouts />
			</div>
			{showCards && (
				<>
					<JudgeCard />
					<RegressionCard />
					<TrendCard />
				</>
			)}

			<div style={{ position: "absolute", left: 0, right: 0, top: 960, height: 60 }}>
				{CAPTIONS.map((c, i) => {
					const o = both(f, c.a, c.b);
					return o > 0 ? <div key={i} className="cap" style={{ opacity: o, transform: `translateY(${(1 - o) * 14}px)` }}>{c.text}</div> : null;
				})}
			</div>
		</AbsoluteFill>
	);
}
