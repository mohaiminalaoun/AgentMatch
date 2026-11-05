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

const PURPLE = "#5b4b9a";
const INK = "#2a2a3c";
const TEAL = "#28bbae";

// Phase starts (30 fps).
const P = { tentative: 30, deadline: 140, identity: 260 };
const MUSE_OK = 172;
const C2_OK = 204;
const LINK_SOLID = 226;
const APPROVAL = 300;
const APPROVED = 346;

const STEPS = [
	{ n: "1", when: "Before deadline", what: "Tentative" },
	{ n: "2", when: "At deadline", what: "Both confirm" },
	{ n: "3", when: "After commitment", what: "Identity" },
];
const CAPTIONS = [
	"The team can still change.",
	"Muse and c2 each confirm.",
	"This pilot waits for human approval before sharing names.",
];

const css = `
.cm { font-family: "DM Sans", sans-serif; color: ${INK}; background: #f6f5fc;
  background-image: radial-gradient(#d9d5ee 2.5px, transparent 2.5px); background-size: 40px 40px; }
.cm .eyebrow { font-size: 26px; letter-spacing: .14em; text-transform: uppercase; color: ${PURPLE}; font-weight: 700; }
.cm .h1 { color: ${INK}; font-size: 84px; line-height: 1.05; font-weight: 600; letter-spacing: -.02em; }
.cm .word { display: inline-block; margin-right: .26em; }
.step { flex: 1; border-radius: 22px; padding: 18px 26px; border: 2px solid #e4def7; background: #fff; }
.step .k { font-size: 20px; letter-spacing: .1em; text-transform: uppercase; color: #9a95b5; font-weight: 700; }
.step .v { font-size: 38px; font-weight: 600; margin-top: 4px; color: #9a95b5; }
.step.on { background: #ece6fa; border-color: ${PURPLE}; }
.step.on .k { color: ${PURPLE}; } .step.on .v { color: ${INK}; }
.namecard { width: 330px; height: 92px; border-radius: 22px; background: #fff; border: 2px solid #e4def7;
  display: flex; align-items: center; gap: 16px; padding: 0 26px; font-size: 30px; font-weight: 600; }
.pill { display: inline-flex; align-items: center; gap: 14px; border-radius: 999px; padding: 14px 30px; font-size: 30px; font-weight: 700; }
`;

const range = (f: number, a: number, b: number, easing = Easing.out(Easing.cubic)) =>
	interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

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

function Check({ at }: { at: number }) {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	const s = spring({ frame: f - at, fps, config: { damping: 8, stiffness: 200, mass: 0.5 } });
	return (
		<div
			style={{
				position: "absolute", right: -6, top: 70, width: 74, height: 74, borderRadius: "50%",
				background: TEAL, border: "6px solid #fff", color: "#fff", fontSize: 40, fontWeight: 800,
				display: "grid", placeItems: "center", transform: `scale(${s})`, boxShadow: "0 10px 24px -8px rgba(40,187,174,.7)",
			}}
		>
			✓
		</div>
	);
}

function Lock({ open, color }: { open: boolean; color: string }) {
	return (
		<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
			<rect x="5" y="11" width="14" height="10" rx="2.5" fill={color} fillOpacity=".22" />
			<path d={open ? "M8 11V8a4 4 0 0 1 7.5-2" : "M8 11V8a4 4 0 0 1 8 0v3"} />
		</svg>
	);
}

export function CommitmentSlide() {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	const phase = f >= P.identity ? 2 : f >= P.deadline ? 1 : 0;

	const popIn = (at: number) => spring({ frame: f - at, fps, config: { damping: 11, stiffness: 140, mass: 0.7 } });
	const museIn = popIn(P.tentative);
	const c2In = popIn(P.tentative + 12);
	const bob = (o: number) => Math.sin((f + o) / 15) * 7;

	// Link: dashed + wobble while tentative; solid once both confirm.
	const solid = range(f, LINK_SOLID, LINK_SOLID + 14);
	const wobble = f < LINK_SOLID ? Math.sin(f / 5) * 3 : 0;
	const linkOn = range(f, P.tentative + 20, P.tentative + 40);

	const tentative = f < LINK_SOLID;
	const approved = f >= APPROVED;
	const approvalIn = spring({ frame: f - APPROVAL, fps, config: { damping: 12, stiffness: 150, mass: 0.6 } });
	const nameLocked = !approved;
	const unlock = spring({ frame: f - APPROVED, fps, config: { damping: 9, stiffness: 180, mass: 0.5 } });

	return (
		<AbsoluteFill className="cm app-insert">
			<style>{css}</style>

			<div style={{ position: "absolute", left: 150, top: 80, opacity: range(f, 0, 14) }}>
				<div className="eyebrow">Disclosure / Level 3</div>
			</div>
			<div style={{ position: "absolute", left: 150, top: 132 }}>
				<Words text="Identity after commitment" start={6} />
			</div>

			{/* step tracker */}
			<div style={{ position: "absolute", left: 150, right: 150, top: 290, display: "flex", gap: 22, opacity: range(f, 18, 40) }}>
				{STEPS.map((s, i) => (
					<div key={i} className={`step${i === phase ? " on" : ""}`} style={{ transform: `scale(${i === phase ? 1 + 0.02 * Math.sin(f / 9) : 1})` }}>
						<div className="k">{s.n} · {s.when}</div>
						<div className="v">{s.what}</div>
					</div>
				))}
			</div>

			{/* agents + link */}
			<div style={{ position: "absolute", left: 0, right: 0, top: 432 }}>
				<div style={{ position: "absolute", left: 590, top: 0, width: 260, opacity: Math.min(1, museIn * 2), transform: `translateY(${bob(0) + (1 - museIn) * 80}px) scale(${0.6 + 0.4 * museIn})`, transformOrigin: "50% 100%" }}>
					<AgentCharacter muse mood={f >= C2_OK + 20 ? "matched" : "idle"} width={260} height={325} />
					{f >= MUSE_OK && <Check at={MUSE_OK} />}
				</div>
				<div style={{ position: "absolute", left: 1070, top: 0, width: 260, opacity: Math.min(1, c2In * 2), transform: `translateY(${bob(20) + (1 - c2In) * 80}px) scale(${0.6 + 0.4 * c2In})`, transformOrigin: "50% 100%" }}>
					<AgentCharacter color={TEAL} sprout level={phase + 1 > 3 ? 3 : phase + 1} mood={f >= C2_OK + 20 ? "matched" : "idle"} badge="c2" width={260} height={325} />
					{f >= C2_OK && <Check at={C2_OK} />}
				</div>
				<svg style={{ position: "absolute", left: 850, top: 120, overflow: "visible" }} width="220" height="40" aria-hidden="true">
					<path d={`M0 20 Q110 ${20 + wobble * 3} 220 20`} fill="none" stroke={PURPLE} strokeWidth="6" strokeLinecap="round" strokeDasharray="4 16" opacity={linkOn * (1 - solid)} />
					<path d="M0 20 L220 20" fill="none" stroke={TEAL} strokeWidth="8" strokeLinecap="round" opacity={solid} strokeDasharray="220" strokeDashoffset={(1 - solid) * 220} />
				</svg>
				{/* state tag over the link */}
				<div style={{ position: "absolute", left: 850, width: 220, top: 36, textAlign: "center", opacity: linkOn }}>
					<span className="pill" style={{ fontSize: 24, padding: "8px 20px", background: tentative ? "#fff" : "#dcf5f1", border: `2px solid ${tentative ? "#ddd3f5" : TEAL}`, color: tentative ? PURPLE : "#13766c", transform: `rotate(${tentative ? Math.sin(f / 6) * 2.5 : 0}deg)` }}>
						{tentative ? "Tentative" : "Committed"}
					</span>
				</div>
			</div>

			{/* name cards + human approval */}
			<div style={{ position: "absolute", left: 0, right: 0, top: 768, opacity: range(f, P.identity - 6, P.identity + 16), transform: `translateY(${(1 - range(f, P.identity - 6, P.identity + 16)) * 30}px)` }}>
				{[[590, "Name"], [1070, "Name"]].map(([x, label], i) => (
					<div key={i} className="namecard" style={{ position: "absolute", left: (x as number) - 35, borderColor: nameLocked ? "#e4def7" : TEAL, transform: `scale(${nameLocked ? 1 : 1 + (1 - unlock) * 0.08})` }}>
						<Lock open={!nameLocked} color={nameLocked ? "#a49fc0" : "#13766c"} />
						<span style={{ color: nameLocked ? "#b0abc8" : INK }}>{nameLocked ? `${label} hidden` : `${label} shared`}</span>
					</div>
				))}
				<div style={{ position: "absolute", left: 0, right: 0, top: 118, textAlign: "center", opacity: Math.min(1, approvalIn * 2), transform: `scale(${0.7 + 0.3 * approvalIn})` }}>
					<span className="pill" style={{ marginLeft: -2, background: approved ? "#dcf5f1" : "#fff", border: `2px solid ${approved ? TEAL : "#ddd3f5"}`, color: approved ? "#13766c" : PURPLE }}>
						{approved ? "✓ Humans approved" : "Waiting for human approval…"}
					</span>
				</div>
			</div>

			{/* caption */}
			<div style={{ position: "absolute", left: 150, right: 150, bottom: 40, height: 54 }}>
				{CAPTIONS.map((c, i) => {
					const start = [P.tentative, P.deadline, P.identity][i]!;
					const inn = range(f, start, start + 16);
					const out = i < 2 ? range(f, start + (i === 0 ? 100 : 114), start + (i === 0 ? 110 : 124), Easing.in(Easing.cubic)) : 0;
					return (
						<div key={i} style={{ position: "absolute", width: "100%", textAlign: "center", fontSize: 36, fontWeight: 600, color: "#5d5878", opacity: inn * (1 - out), transform: `translateY(${(1 - inn) * 18 - out * 14}px)` }}>
							{c}
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
}
