import React from "react";
import {
	AbsoluteFill,
	Easing,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { AgentCharacter } from "../../../src/ui/web/AgentCharacter";
import "./video.css";

/*
 * One scene, one persistent diagram: two private rooms, the arena between them.
 * Every text below is from a recorded run:
 *  - Rosa + p4: runs/2026-10-28T21-11-24-894Z-simulate.jsonl (gate rejection of Rosa's draft)
 *  - Travis + c8: runs/2026-11-02T22-10-50-198Z-pilot.jsonl (hunch on private note 5, then his counter)
 */

const PURPLE = "#5b4b9a";
const INK = "#2a2a3c";
const TEAL = "#28bbae";
const RED = "#b4232f";
const AMBER = "#c77d0a";

// ---- layout ---------------------------------------------------------------
const ROOM_TOP = 240;
const ROOM_H = 670;
const LEFT_X = 70;
const RIGHT_X = 1330;
const ROOM_W = 520;
const GATE_X = 958;
const BOX_Y = ROOM_TOP + 510; // inbox / draft box row
const ENV_W = 360;
const ENV_LEFT_IN_LEFT_ROOM = 110;
const ENV_LEFT_IN_RIGHT_ROOM = 1370;
const ENV_AT_GATE = GATE_X - ENV_W - 6;

// ---- timeline (30 fps) ------------------------------------------------------
const A = {
	roomsIn: 20,
	p4Send: 200,
	p4Arrive: 260,
	draft1: 292,
	envOut: 392,
	hit: 424,
	bounceEnd: 462,
	draft2: 500,
	env2Out: 566,
	env2Arrive: 636,
	swap: 700,
};
const B = {
	roomsIn: 730,
	c8Send: 770,
	c8Arrive: 830,
	noteGlow: 860,
	hunch: 884,
	draft: 944,
	envOut: 1018,
	envArrive: 1086,
	end: 1120,
};
const RESULT = 1140;
export const ARENA_PRIVACY_FRAMES = 1360;

// ---- content ----------------------------------------------------------------
type Part = { t: string; m?: "bad" | "good" };
const txt = (parts: Part[]) => parts.map((p) => p.t).join("");

const P4_PROPOSAL: Part[] = [
	{ t: "Join your project: An open source dashboard to explore and track open source projects in one place." },
];
const ROSA_DRAFT1: Part[] = [
	{ t: "Let's build an open source dashboard to explore and track open source projects in one place, " },
	{ t: "with Rosa on backend", m: "bad" },
	{ t: ". …" },
];
const ROSA_DRAFT2: Part[] = [
	{ t: "Join us to build an open source dashboard to explore and track open source projects in one place.", m: "good" },
];
const C8_COUNTER: Part[] = [
	{ t: "Agent Last Mile: Shared ride coordination for late-shift workers where an agent proposes safe overlapping shared trips and shows why they match." },
];
const TRAVIS_COUNTER: Part[] = [
	{ t: "Last Mile: Shared ride coordination for late-shift workers at one workplace using " },
	{ t: "approximate destination areas", m: "good" },
	{ t: " and fictional trips …" },
];

type Row = { tag: string; level: "L0" | "L1" | "L2" | "L3" | "never"; value: string; id: string };
const ROSA_ROWS: Row[] = [
	{ id: "idea", tag: "Idea", level: "L0", value: "Open source dashboard" },
	{ id: "interests", tag: "Interests", level: "L1", value: "open source, civic" },
	{ id: "skills", tag: "Skills", level: "L2", value: "backend, mobile" },
	{ id: "name", tag: "Name", level: "L3", value: "Rosa" },
];
const TRAVIS_ROWS: Row[] = [
	{ id: "idea", tag: "Idea", level: "L0", value: "Last Mile" },
	{ id: "interests", tag: "Interests", level: "L1", value: "transportation, mobility" },
	{ id: "skills", tag: "Skills", level: "L2", value: "frontend, design" },
	{ id: "never", tag: "Note", level: "never", value: "" },
];
const STRANGER_ROWS: Row[] = [
	{ id: "idea", tag: "Idea", level: "L0", value: "" },
	{ id: "interests", tag: "Interests", level: "L1", value: "" },
	{ id: "skills", tag: "Skills", level: "L2", value: "" },
	{ id: "name", tag: "Name", level: "L3", value: "" },
];

const CAPTIONS: { a: number; b: number; text: string }[] = [
	{ a: 60, b: 122, text: "Each agent has its own memory and its own model." },
	{ a: 126, b: 196, text: "Any model can be a mind. The harness around them is deterministic code." },
	{ a: 206, b: 384, text: "Agents never talk directly. The arena only carries typed messages." },
	{ a: 392, b: 560, text: "Every outgoing message is checked in code first. At Level 0, only the project idea may leave." },
	{ a: 566, b: 700, text: "p4 never receives the first draft." },
	{ a: 760, b: 878, text: "Notes can be marked never. Even the agent's own prompt never carries them." },
	{ a: 884, b: 1012, text: "A private hunch turns a note into a steer: careful. The note itself stays in the room." },
	{ a: 1018, b: 1130, text: "Only the message crosses. The note never does." },
	{ a: 1160, b: 1360, text: "Two small checks on sample scenarios." },
];

// ---- helpers ----------------------------------------------------------------
const range = (f: number, a: number, b: number, easing = Easing.out(Easing.cubic)) =>
	interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
const both = (f: number, a: number, b: number) => Math.min(range(f, a, a + 14), 1 - range(f, b - 12, b, Easing.in(Easing.cubic)));

const LEVEL_COLORS: Record<Row["level"], { bg: string; fg: string }> = {
	L0: { bg: "#d8f3ef", fg: "#13766c" },
	L1: { bg: "#dbe7fb", fg: "#2f5fae" },
	L2: { bg: "#e4dcf8", fg: "#5b4b9a" },
	L3: { bg: "#2f2a45", fg: "#f1ecff" },
	never: { bg: "#3a2f1c", fg: "#ffd9a0" },
};

const css = `
.ap { font-family: "DM Sans", sans-serif; color: ${INK}; background: #f6f5fc;
  background-image: radial-gradient(#d9d5ee 2.5px, transparent 2.5px); background-size: 40px 40px; }
.ap .eyebrow { font-size: 24px; letter-spacing: .14em; text-transform: uppercase; color: ${PURPLE}; font-weight: 700; }
.ap .h1 { color: ${INK}; font-size: 76px; line-height: 1.05; font-weight: 600; letter-spacing: -.02em; }
.ap .word { display: inline-block; margin-right: .26em; }
.room { position: absolute; width: ${ROOM_W}px; height: ${ROOM_H}px; top: ${ROOM_TOP}px; border-radius: 30px; background: #fff;
  border: 3px dashed #cfc7ee; box-shadow: 0 34px 60px -40px rgba(60,40,120,.4); }
.room .lock { position: absolute; top: 18px; right: 22px; font-size: 18px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #9a95b5; }
.row { position: absolute; left: 24px; right: 24px; height: 56px; border-radius: 16px; background: #f6f4fd; display: flex; align-items: center; gap: 12px; padding: 0 16px; font-size: 22px; font-weight: 600; }
.lvl { flex: none; border-radius: 9px; padding: 3px 10px; font-size: 17px; font-weight: 800; letter-spacing: .04em; }
.row .tag { flex: none; width: 112px; color: #6a6682; font-size: 21px; font-weight: 700; }
.row .val { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.hide { height: 18px; border-radius: 9px; background: #dcd7ee; }
.msgbox { position: absolute; left: 20px; right: 20px; height: 152px; border-radius: 20px; border: 2px solid #e4def7; background: #fbfaff; padding: 12px 20px; }
.msgbox .lbl { font-size: 17px; letter-spacing: .12em; text-transform: uppercase; font-weight: 800; color: #9a95b5; margin-bottom: 6px; }
.msgbox .body { font-size: 20px; line-height: 1.28; font-weight: 500; }
.env { position: absolute; width: ${ENV_W}px; border-radius: 20px; background: #fff; border: 3px solid #bdb1ec; padding: 12px 18px 14px;
  box-shadow: 0 20px 36px -16px rgba(60,40,120,.5); font-size: 20px; line-height: 1.3; z-index: 20; }
.env .kind { font-size: 15px; letter-spacing: .12em; text-transform: uppercase; font-weight: 800; color: ${PURPLE}; margin-bottom: 4px; }
.env .clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-weight: 500; }
.bad { background: #fbd5d8; color: ${RED}; border-radius: 6px; padding: 0 4px; font-weight: 700; }
.good { background: #cfeee9; color: #0d5e55; border-radius: 6px; padding: 0 4px; font-weight: 700; }
.chip { display: inline-flex; align-items: center; gap: 10px; border-radius: 999px; padding: 8px 20px; font-size: 22px; font-weight: 700; }
.cap { position: absolute; left: 110px; right: 110px; text-align: center; font-size: 36px; font-weight: 600; color: #5d5878; }
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

function Lock({ color = "#9a95b5", size = 22 }: { color?: string; size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
			<rect x="5" y="11" width="14" height="10" rx="2.5" fill={color} fillOpacity=".22" />
			<path d="M8 11V8a4 4 0 0 1 8 0v3" />
		</svg>
	);
}

function PartsView({ parts, chars }: { parts: Part[]; chars: number }) {
	let left = chars;
	return (
		<>
			{parts.map((p, i) => {
				const s = p.t.slice(0, Math.max(0, left));
				left -= p.t.length;
				if (!s) return null;
				return p.m ? (
					<span key={i} className={p.m}>
						{s}
					</span>
				) : (
					<span key={i}>{s}</span>
				);
			})}
		</>
	);
}

type Seg = { a: number; b: number; label: string; parts: Part[]; typeFrom?: number };
function MsgBox({ side, y, segs }: { side: "left" | "right"; y: number; segs: Seg[] }) {
	const f = useCurrentFrame();
	const seg = [...segs].reverse().find((s) => f >= s.a && f < s.b);
	const op = seg ? Math.min(range(f, seg.a, seg.a + 8), 1 - range(f, seg.b - 6, seg.b)) : 1;
	const chars = seg ? (seg.typeFrom !== undefined ? Math.floor(Math.max(0, f - seg.typeFrom) * 1.9) : 999) : 0;
	return (
		<div className="msgbox" style={{ top: y - ROOM_TOP, ...(side === "left" ? {} : {}) }}>
			<div className="lbl">{seg?.label ?? "Inbox"}</div>
			<div className="body" style={{ opacity: seg ? op : 1, color: seg ? INK : "#b8b3cd" }}>
				{seg ? <PartsView parts={seg.parts} chars={chars} /> : "Nothing yet"}
			</div>
		</div>
	);
}


function Room({
	x, name, color, badge, rows, hidden, appear, pulse, noteGlow, children,
}: {
	x: number; name: string; color: string; badge: string; rows: Row[]; hidden?: boolean; appear: number;
	pulse?: Record<string, number>; noteGlow?: number; children?: React.ReactNode;
}) {
	const f = useCurrentFrame();
	const p = range(f, appear, appear + 26);
	return (
		<div className="room" style={{ left: x, opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
			<div className="lock">
				<Lock size={18} /> <span style={{ marginLeft: 6 }}>Private</span>
			</div>
			<div style={{ position: "absolute", left: 24, top: 18 }}>
				<AgentCharacter color={color} badge={badge} width={118} height={148} />
			</div>
			<div style={{ position: "absolute", left: 160, top: 52 }}>
				<div style={{ fontSize: 40, fontWeight: 700 }}>{name}</div>
				<div style={{ fontSize: 21, fontWeight: 600, color: "#7a7592" }}>own context + memory</div>
			</div>
			{rows.map((r, i) => {
				const pl = pulse?.[r.id] ?? 0;
				const lc = LEVEL_COLORS[r.level];
				const isNever = r.level === "never";
				const glow = isNever ? noteGlow ?? 0 : 0;
				return (
					<div
						key={r.id}
						className="row"
						style={{
							top: 184 + i * 64,
							background: pl > 0 ? `rgba(251,213,216,${0.3 + 0.7 * pl})` : glow > 0 ? `rgba(255,217,160,${0.25 + 0.6 * glow})` : "#f6f4fd",
							outline: pl > 0 ? `3px solid rgba(180,35,47,${pl})` : glow > 0 ? `3px solid rgba(199,125,10,${glow})` : "none",
							transform: `translateX(${pl > 0 ? Math.sin(f * 2.3) * 5 * pl : 0}px)`,
						}}
					>
						<span className="lvl" style={{ background: lc.bg, color: lc.fg }}>{r.level === "never" ? "never" : r.level}</span>
						<span className="tag">{r.tag}</span>
						{hidden || isNever ? (
							<span style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
								<span className="hide" style={{ width: isNever ? 170 : 120 + (i % 2) * 40 }} />
								<Lock size={20} color={isNever ? AMBER : "#b0abc8"} />
							</span>
						) : (
							<span className="val" style={{ color: pl > 0 ? RED : INK }}>{r.value}</span>
						)}
					</div>
				);
			})}
			{children}
		</div>
	);
}

type Env = {
	a: number; b: number; from: number; to: number; parts: Part[]; kind: string; tone?: "good";
	block?: { hitAt: number; backAt: number }; // goes to gate, is stopped, bounces back
};
function Envelope({ e }: { e: Env }) {
	const f = useCurrentFrame();
	if (f < e.a - 2 || f > e.b + 10) return null;
	let left: number;
	let op = range(f, e.a - 2, e.a + 6);
	let shake = 0;
	let border = "#bdb1ec";
	if (e.block) {
		const run = range(f, e.a, e.block.hitAt, Easing.inOut(Easing.cubic));
		const back = range(f, e.block.hitAt + 14, e.block.backAt, Easing.in(Easing.cubic));
		left = e.from + (ENV_AT_GATE - e.from) * run - (ENV_AT_GATE - e.from) * back * 0.35;
		if (f >= e.block.hitAt) {
			border = RED;
			shake = f < e.block.hitAt + 14 ? Math.sin(f * 2.6) * (e.block.hitAt + 14 - f) * 0.9 : 0;
		}
		op = op * (1 - range(f, e.block.hitAt + 20, e.block.backAt + 6));
	} else {
		const t = range(f, e.a, e.b, Easing.inOut(Easing.cubic));
		left = e.from + (e.to - e.from) * t;
		op = op * (1 - range(f, e.b - 4, e.b + 8));
		if (e.tone === "good" && Math.abs(left + ENV_W / 2 - GATE_X) < 190) border = TEAL;
	}
	return (
		<div className="env" style={{ left: left + shake, top: BOX_Y - 6, opacity: op, borderColor: border }}>
			<div className="kind" style={{ color: border === RED ? RED : border === TEAL ? "#13766c" : PURPLE }}>{e.kind}</div>
			<div className="clamp"><PartsView parts={e.parts} chars={999} /></div>
		</div>
	);
}

function Gate({ flash }: { flash: { red: number; green: number } }) {
	const f = useCurrentFrame();
	const color = flash.red > 0 ? `rgb(${Math.round(180 + 0 * flash.red)},${Math.round(35 + 160 * (1 - flash.red))},${Math.round(47 + 160 * (1 - flash.red))})`
		: flash.green > 0 ? "#28bbae" : "#8f82cf";
	const glow = flash.red > 0 ? `0 0 ${50 * flash.red}px rgba(180,35,47,${0.7 * flash.red})` : flash.green > 0 ? `0 0 ${40 * flash.green}px rgba(40,187,174,${0.7 * flash.green})` : "none";
	return (
		<>
			<div style={{ position: "absolute", left: GATE_X, top: 330, width: 14, height: 560, borderRadius: 7, background: color, boxShadow: glow }} />
			<div style={{ position: "absolute", left: GATE_X + 7 - 150, top: 286, width: 300, textAlign: "center" }}>
				<span className="chip" style={{ whiteSpace: "nowrap", background: "#fff", border: `2px solid ${flash.red > 0 ? RED : "#d6cdf3"}`, color: flash.red > 0 ? RED : PURPLE, fontSize: 21 }}>
					{"</>"} Disclosure gate
				</span>
			</div>
			<div style={{ position: "absolute", left: GATE_X + 7 - 290, top: 242, width: 580, textAlign: "center", fontSize: 20, letterSpacing: ".14em", fontWeight: 800, color: "#7d77a0", textTransform: "uppercase" }}>
				Arena · deterministic harness
			</div>
		</>
	);
}


const MODELS = [
	{ name: "Muse Spark", ver: "1.3", sub: "Model API", note: "runs most agents", meta: true, fg: "#4a3a8a", bg: "#ece6fa", bd: "#cfc4f3" },
	{ name: "Muse Wonder", ver: "1.0", sub: "Model API", note: "a different model", meta: true, fg: "#7a3b8f", bg: "#f5e6fb", bd: "#e1c4ef" },
	{ name: "Muse", ver: "app", sub: "mailbox", note: "a person's own agent", meta: true, fg: "#0d6b62", bg: "#e3f6f2", bd: "#b7e5dd" },
	{ name: "Grokbot", ver: "outside", sub: "webhook", note: "any outside agent", meta: false, fg: "#f1f1f6", bg: "#2b2f3a", bd: "#2b2f3a" },
];
const FAN_A = 62;
const FAN_OUT = 172;
function ModelFan() {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	const xs = [-255, -85, 85, 255];
	const rots = [-7, -2.5, 2.5, 7];
	const ys = [24, 0, 0, 24];
	const retract = range(f, FAN_OUT, FAN_OUT + 22, Easing.in(Easing.cubic));
	if (f < FAN_A || f > FAN_OUT + 24) return null;
	return (
		<>
			{MODELS.map((m, i) => {
				const sp = spring({ frame: f - FAN_A - i * 6, fps, config: { damping: 12, stiffness: 120, mass: 0.7 } });
				const spread = sp * (1 - retract);
				const bob = Math.sin((f + i * 17) / 14) * 6 * (1 - retract);
				return (
					<div
						key={m.name}
						style={{
							position: "absolute", left: GATE_X + 7 - 80 + xs[i]! * spread, top: 520 + ys[i]! * spread + bob, width: 160, height: 214,
							borderRadius: 24, background: "#fff", border: `3px solid ${m.bd}`, boxShadow: "0 28px 40px -22px rgba(60,40,120,.5)",
							transform: `rotate(${rots[i]! * spread}deg) scale(${0.35 + 0.65 * spread})`, opacity: Math.min(1, spread * 2.2), zIndex: 30,
							overflow: "hidden", textAlign: "center",
						}}
					>
						<div style={{ height: 62, background: m.bg, display: "grid", placeItems: "center" }}>
							<div style={{ width: 34, height: 34, borderRadius: 17, background: m.fg === "#f1f1f6" ? "#2b2f3a" : m.fg, opacity: 0.9 }} />
						</div>
						<div style={{ padding: "10px 8px 0", fontSize: 24, fontWeight: 800, lineHeight: 1.1, color: INK }}>{m.name}</div>
						<div style={{ fontSize: 22, fontWeight: 700, color: m.fg === "#f1f1f6" ? "#5d5878" : m.fg }}>{m.ver}</div>
						<div style={{ fontSize: 17, fontWeight: 700, color: "#9a95b5", letterSpacing: ".06em", textTransform: "uppercase", marginTop: 4 }}>{m.sub}</div>
						<div style={{ fontSize: 17, fontWeight: 600, color: "#6a6682", marginTop: 4 }}>{m.note}</div>
						{m.meta && (
							<div style={{ position: "absolute", left: 0, right: 0, top: 4 }}>
								<span style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".1em", color: m.fg, background: "#fff", borderRadius: 8, padding: "2px 8px" }}>META</span>
							</div>
						)}
					</div>
				);
			})}
		</>
	);
}

function Findings() {
	const f = useCurrentFrame();
	const items = [
		{ at: A.hit + 6, t: "name", l: "Level 3" },
		{ at: A.hit + 16, t: "skills", l: "Level 2" },
		{ at: A.hit + 26, t: "preferred role", l: "Level 2" },
	];
	const out = 1 - range(f, A.bounceEnd + 28, A.bounceEnd + 44);
	return (
		<div style={{ position: "absolute", left: GATE_X + 7 - 170, top: 380, width: 340, opacity: out }}>
			{items.map((it, i) => {
				const p = range(f, it.at, it.at + 12);
				return (
					<div key={i} style={{ marginBottom: 12, opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
						<span className="chip" style={{ background: "#fdebec", border: "2px solid #f3b4b8", color: RED }}>
							✕ {it.t} <span style={{ fontWeight: 600, opacity: 0.8 }}>not before {it.l}</span>
						</span>
					</div>
				);
			})}
		</div>
	);
}

export function ArenaPrivacy() {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();

	const inA = f < A.swap + 20;
	const stageOut = 1 - range(f, RESULT - 14, RESULT + 4);
	const stage = f < RESULT ? stageOut : 0;

	// cast swap fades
	const castA = (1 - range(f, A.swap, A.swap + 24)) ;
	const castB = range(f, B.roomsIn - 6, B.roomsIn + 20) * stageOut;

	// gate flash windows
	const red = f >= A.hit && f < A.hit + 70 ? 1 - range(f, A.hit + 10, A.hit + 70, Easing.linear) : 0;
	const passA = f >= A.env2Out + 18 && f < A.env2Out + 60 ? Math.sin(range(f, A.env2Out + 18, A.env2Out + 60, Easing.linear) * Math.PI) : 0;
	const passB = f >= B.envOut + 18 && f < B.envOut + 60 ? Math.sin(range(f, B.envOut + 18, B.envOut + 60, Easing.linear) * Math.PI) : 0;
	const pass = Math.max(passA, passB);
	const gateFlash = { red: red > 0.001 ? Math.max(0.2, red) : 0, green: red > 0 ? 0 : pass };

	const rosaPulse = {
		name: f >= A.hit + 4 && f < A.hit + 100 ? range(f, A.hit + 4, A.hit + 14) * (1 - range(f, A.hit + 80, A.hit + 100)) : 0,
		skills: f >= A.hit + 14 && f < A.hit + 100 ? range(f, A.hit + 14, A.hit + 24) * (1 - range(f, A.hit + 80, A.hit + 100)) : 0,
	};
	const noteGlow = range(f, B.noteGlow, B.noteGlow + 16) * (1 - range(f, B.draft + 40, B.draft + 70));

	const hunchP = spring({ frame: f - B.hunch, fps, config: { damping: 11, stiffness: 150, mass: 0.6 } });

	// result panel
	const rp = range(f, RESULT + 10, RESULT + 40);
	const count = (end: number, a: number, b: number) => Math.round(end * range(f, a, b));
	const beforeN = count(3, RESULT + 40, RESULT + 70);
	const afterN = count(4, RESULT + 90, RESULT + 120);

	return (
		<AbsoluteFill className="ap app-insert">
			<style>{css}</style>

			<div style={{ position: "absolute", left: 110, top: 52, opacity: range(f, 0, 14) }}>
				<div className="eyebrow">Disclosure / The arena</div>
			</div>
			<div style={{ position: "absolute", left: 110, top: 96 }}>
				<Words text="Private minds, structured messages" start={6} />
			</div>

			{/* ---------- stage ---------- */}
			<div style={{ opacity: stage }}>
				<Gate flash={gateFlash} />
				<Findings />
				<ModelFan />

				{/* cast A: Rosa + p4 */}
				{f < A.swap + 26 && (
					<div style={{ opacity: castA }}>
						<Room x={LEFT_X} name="Rosa" color="#e0709a" badge="R" rows={ROSA_ROWS} appear={A.roomsIn} pulse={rosaPulse}>
							<MsgBox side="left" y={BOX_Y} segs={[
								{ a: A.p4Arrive, b: A.draft1 - 2, label: "Inbox · proposal from p4", parts: P4_PROPOSAL },
								{ a: A.draft1 - 2, b: A.draft2 - 4, label: "Draft counter · private", parts: ROSA_DRAFT1, typeFrom: A.draft1 },
								{ a: A.draft2 - 4, b: 9999, label: "Draft counter · private", parts: ROSA_DRAFT2, typeFrom: A.draft2 },
							]} />
						</Room>
						<Room x={RIGHT_X} name="p4" color="#8a6fe0" badge="p4" rows={STRANGER_ROWS} hidden appear={A.roomsIn + 8}>
							<MsgBox side="right" y={BOX_Y} segs={[
								{ a: 0, b: A.p4Send + 4, label: "Outbox", parts: P4_PROPOSAL },
								{ a: A.env2Arrive - 4, b: 9999, label: "Inbox · counter from Rosa's agent", parts: ROSA_DRAFT2 },
							]} />
						</Room>
						<Envelope e={{ a: A.p4Send, b: A.p4Arrive, from: ENV_LEFT_IN_RIGHT_ROOM, to: ENV_LEFT_IN_LEFT_ROOM, parts: P4_PROPOSAL, kind: "proposal · level 0", tone: "good" }} />
						<Envelope e={{ a: A.envOut, b: A.bounceEnd, from: ENV_LEFT_IN_LEFT_ROOM, to: ENV_AT_GATE, parts: ROSA_DRAFT1, kind: "counter · level 0", block: { hitAt: A.hit, backAt: A.bounceEnd } }} />
						<Envelope e={{ a: A.env2Out, b: A.env2Arrive, from: ENV_LEFT_IN_LEFT_ROOM, to: ENV_LEFT_IN_RIGHT_ROOM, parts: ROSA_DRAFT2, kind: "counter · level 0", tone: "good" }} />
					</div>
				)}

				{/* cast B: Travis + c8 */}
				{f >= B.roomsIn - 8 && (
					<div style={{ opacity: castB }}>
						<Room x={LEFT_X} name="Travis" color="#f08a4b" badge="T" rows={TRAVIS_ROWS} appear={B.roomsIn} noteGlow={noteGlow}>
							{/* hunch */}
							<div style={{ position: "absolute", left: 24, right: 24, top: 446, height: 52, opacity: Math.min(1, hunchP * 2) }}>
								<svg width="30" height="26" style={{ position: "absolute", left: 40, top: -22, overflow: "visible" }} aria-hidden="true">
									<path d="M10 22 L10 2" stroke={AMBER} strokeWidth="3" strokeDasharray="4 5" strokeLinecap="round" fill="none" />
								</svg>
								<div className="chip" style={{ background: "#fff4df", border: `2px solid ${AMBER}`, color: "#8a5206", transform: `scale(${0.7 + 0.3 * hunchP})`, transformOrigin: "0 50%", fontSize: 21 }}>
									Hunch · careful · scope <span style={{ fontWeight: 600, opacity: 0.75 }}>steered by note 5</span>
								</div>
							</div>
							<MsgBox side="left" y={BOX_Y} segs={[
								{ a: B.c8Arrive, b: B.draft - 2, label: "Inbox · counter from c8", parts: C8_COUNTER },
								{ a: B.draft - 2, b: 9999, label: "Draft counter · private", parts: TRAVIS_COUNTER, typeFrom: B.draft },
							]} />
						</Room>
						<Room x={RIGHT_X} name="c8" color="#518ce2" badge="c8" rows={STRANGER_ROWS} hidden appear={B.roomsIn + 8}>
							<MsgBox side="right" y={BOX_Y} segs={[
								{ a: 0, b: B.c8Send + 4, label: "Outbox", parts: C8_COUNTER },
								{ a: B.envArrive - 4, b: 9999, label: "Inbox · counter from Travis's agent", parts: TRAVIS_COUNTER },
							]} />
						</Room>
						<Envelope e={{ a: B.c8Send, b: B.c8Arrive, from: ENV_LEFT_IN_RIGHT_ROOM, to: ENV_LEFT_IN_LEFT_ROOM, parts: C8_COUNTER, kind: "counter · level 0", tone: "good" }} />
						<Envelope e={{ a: B.envOut, b: B.envArrive, from: ENV_LEFT_IN_LEFT_ROOM, to: ENV_LEFT_IN_RIGHT_ROOM, parts: TRAVIS_COUNTER, kind: "counter · level 0", tone: "good" }} />
						{/* what crossed, and what did not */}
						<div style={{ position: "absolute", left: GATE_X + 7 - 170, top: 400, width: 340, opacity: both(f, B.envOut + 20, B.end) }}>
							<span className="chip" style={{ background: "#fff4df", border: `2px solid ${AMBER}`, color: "#8a5206" }}>
								<Lock size={20} color={AMBER} /> note 5 stays in the room
							</span>
						</div>
					</div>
				)}
			</div>

			{/* ---------- result ---------- */}
			{f >= RESULT && (
				<div style={{ position: "absolute", left: 110, right: 110, top: 290, opacity: rp }}>
					<div style={{ fontSize: 34, fontWeight: 700, color: PURPLE, marginBottom: 26 }}>
						Early reliability checks: decline messages
					</div>
					<div style={{ display: "flex", gap: 44 }}>
						<ResultCard label="Before" n={beforeN} of={9} bad={3} sub="Declines sent with out-of-level information." tone="bad" progress={range(f, RESULT + 40, RESULT + 70)} />
						<ResultCard label="After" n={afterN > 0 && f > RESULT + 90 ? 0 : 0} shown={f > RESULT + 90 ? "0" : ""} of={4} bad={0} sub="With the gate and standardized refusals." tone="good" progress={range(f, RESULT + 90, RESULT + 120)} />
					</div>
				</div>
			)}

			{/* ---------- captions ---------- */}
			<div style={{ position: "absolute", left: 0, right: 0, top: 944, height: 60 }}>
				{CAPTIONS.map((c, i) => {
					const o = both(f, c.a, c.b);
					return o > 0 ? (
						<div key={i} className="cap" style={{ opacity: o, transform: `translateY(${(1 - o) * 14}px)` }}>{c.text}</div>
					) : null;
				})}
			</div>
		</AbsoluteFill>
	);
}

function ResultCard({ label, n, shown, of, bad, sub, tone, progress }: {
	label: string; n: number; shown?: string; of: number; bad: number; sub: string; tone: "bad" | "good"; progress: number;
}) {
	const fg = tone === "bad" ? RED : "#13766c";
	const bg = tone === "bad" ? "#fdf0f0" : "#eaf8f5";
	const bd = tone === "bad" ? "#f3c4c8" : "#bfe8e1";
	return (
		<div style={{ flex: 1, background: bg, border: `2px solid ${bd}`, borderRadius: 30, padding: "34px 44px", minHeight: 420, opacity: Math.min(1, progress * 3 + 0.0) }}>
			<div style={{ fontSize: 24, fontWeight: 800, letterSpacing: ".14em", textTransform: "uppercase", color: fg }}>{label}</div>
			<div style={{ fontSize: 150, fontWeight: 700, lineHeight: 1.05, color: INK, letterSpacing: "-.03em", marginTop: 6 }}>
				<span style={{ color: fg }}>{shown !== undefined ? shown : n}</span>
				<span style={{ fontSize: 70, fontWeight: 600, color: "#6a6682" }}> of {of}</span>
			</div>
			<div style={{ display: "flex", gap: 14, margin: "20px 0 22px" }}>
				{Array.from({ length: of }).map((_, i) => {
					const isBad = i < bad;
					const on = progress > (i + 1) / (of + 1);
					return (
						<div key={i} style={{ width: 54, height: 54, borderRadius: "50%", background: !on ? "#ddd8ee" : isBad ? "#e5545f" : TEAL, display: "grid", placeItems: "center", color: "#fff", fontSize: 30, fontWeight: 800, transform: `scale(${on ? 1 : 0.8})` }}>
							{on ? (isBad ? "!" : "✓") : ""}
						</div>
					);
				})}
			</div>
			<div style={{ fontSize: 30, fontWeight: 600, color: "#5d5878", lineHeight: 1.35 }}>{sub}</div>
		</div>
	);
}
