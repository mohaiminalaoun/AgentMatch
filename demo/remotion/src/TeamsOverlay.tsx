import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import "./video.css";

/*
 * Transparent overlay for the "Teams start to take shape." scene.
 * Source: runs/2026-11-03T17-57-10-749Z-pilot.jsonl. Teams are in the order they first formed;
 * eight formed, seven committed at the deadline (14 of 18 people placed), one never committed
 * (c7's agent was not confident at the deadline: the group was two people and he wanted three or four).
 * Only team names and the members' agent ids, as the app shows them. No rationales, no notes.
 *
 * Placement: the block sits under the scene's title and caption on the left. Move it with ORIGIN_X / ORIGIN_Y.
 */
const ORIGIN_X = 90;
const ORIGIN_Y = 700;
const COL_W = 305;
const ROW_H = 68;

const PURPLE = "#5b4b9a";
const INK = "#2a2a3c";
const TEAL = "#28bbae";
const AMBER = "#c77d0a";

type Team = { name: string; members: string; committed: boolean; muse?: boolean };
const TEAMS: Team[] = [
	{ name: "Audio Maths Companion", members: "c12 + c5", committed: true },
	{ name: "Tactics Replay Lite", members: "c14 + c7", committed: false },
	{ name: "Action Firewall", members: "c8 + c1", committed: true },
	{ name: "Agent Flight Recorder", members: "bwwbwk + c2", committed: true, muse: true },
	{ name: "Study Quest", members: "nafisa + sammy", committed: true },
	{ name: "Flood Alert Map", members: "c4 + c11", committed: true },
	{ name: "Chat Ledger", members: "c6 + c13", committed: true },
	{ name: "Smear Check", members: "c3 + c10", committed: true },
];

// timeline (30 fps). Teams form as tentative groups; at the deadline the committed ones turn solid.
const T = { counter: 10, first: 40, gap: 36, deadline: 380, solid: 408, solidGap: 14, fade: 560 };
export const TEAMS_OVERLAY_FRAMES = 680;

const range = (f: number, a: number, b: number, e = Easing.out(Easing.cubic)) =>
	interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });

const css = `
.to { font-family: "DM Sans", sans-serif; color: ${INK}; }
.to .chipc { position: absolute; width: ${COL_W}px; height: ${ROW_H - 8}px; border-radius: 18px; padding: 8px 16px; background: #fff; box-sizing: border-box;
  box-shadow: 0 18px 30px -20px rgba(60,40,120,.55); }
.to .nm { font-size: 21px; font-weight: 800; line-height: 1.15; white-space: nowrap; }
.to .mem { font-size: 16px; font-weight: 600; color: #7a7592; margin-top: 2px; font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; white-space: nowrap; }
`;

export function TeamsOverlay({ preview = false }: { preview?: boolean }) {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();

	// the number of people placed ticks up as teams turn solid
	const committedOrder = TEAMS.map((t, i) => (t.committed ? i : -1)).filter((i) => i >= 0);
	let placed = 0;
	committedOrder.forEach((_, k) => {
		if (f >= T.solid + k * T.solidGap + 8) placed += 2;
	});
	const counterIn = range(f, T.counter, T.counter + 20);
	const deadlineP = range(f, T.deadline, T.deadline + 14) * (1 - range(f, T.solid + 8 * T.solidGap, T.solid + 8 * T.solidGap + 30));

	return (
		<AbsoluteFill className="to app-insert" style={{ background: preview ? "#f7f8fa" : "transparent" }}>
			<style>{css}</style>

			{/* counter */}
			<div style={{ position: "absolute", left: ORIGIN_X, top: ORIGIN_Y - 6, opacity: counterIn, transform: `translateY(${(1 - counterIn) * 14}px)`, display: "flex", alignItems: "baseline", gap: 14 }}>
				<span style={{ fontSize: 22, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: PURPLE }}>People placed</span>
				<span style={{ fontSize: 54, fontWeight: 800, letterSpacing: "-.02em", color: placed > 0 ? "#13766c" : INK, fontFamily: '"DM Sans", sans-serif', transform: `scale(${1 + 0.0})` }}>{placed}</span>
				<span style={{ fontSize: 30, fontWeight: 700, color: "#7a7592" }}>/ 18</span>
				<span style={{ marginLeft: 8, fontSize: 21, fontWeight: 800, color: AMBER, opacity: deadlineP, whiteSpace: "nowrap" }}>deadline</span>
			</div>

			{/* team cards */}
			{TEAMS.map((t, i) => {
				const col = i % 2, row = Math.floor(i / 2);
				const at = T.first + i * T.gap;
				const p = spring({ frame: f - at, fps, config: { damping: 12, stiffness: 140, mass: 0.7 } });
				const k = committedOrder.indexOf(i);
				const solidAt = k >= 0 ? T.solid + k * T.solidGap : Infinity;
				const solid = k >= 0 ? range(f, solidAt, solidAt + 12) : 0;
				const pop = k >= 0 ? spring({ frame: f - solidAt, fps, config: { damping: 8, stiffness: 220, mass: 0.5 } }) : 0;
				// the one that never commits: dashed to the end, then fades
				const fade = !t.committed ? 1 - range(f, T.fade, T.fade + 30) : 1;
				const dashed = 1 - solid;
				const wob = !t.committed && f > T.deadline ? Math.sin(f * 1.6) * 2 * (1 - range(f, T.deadline + 30, T.deadline + 50)) : 0;
				return (
					<div
						key={t.name}
						className="chipc"
						style={{
							left: ORIGIN_X + col * (COL_W + 20) + wob, top: ORIGIN_Y + 66 + row * ROW_H,
							opacity: Math.min(1, p * 2.2) * fade,
							transform: `translateY(${(1 - p) * 40}px) scale(${0.85 + 0.15 * p + (k >= 0 ? 0.04 * (pop > 0 ? Math.max(0, 1 - Math.abs(pop - 1) * 1) * 0 : 0) : 0)})`,
							border: `2.5px ${dashed > 0.5 ? "dashed" : "solid"} ${dashed > 0.5 ? "#b9acec" : TEAL}`,
							background: solid > 0.5 ? "#eaf8f5" : "#fff",
						}}
					>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<span className="nm">{t.name}</span>
							{solid > 0.5 && <span style={{ marginLeft: "auto", color: "#0f8d82", fontWeight: 800, fontSize: 20, transform: `scale(${pop})` }}>✓</span>}
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<span className="mem">{t.members}</span>
							{t.muse && <span style={{ fontSize: 13, fontWeight: 800, color: PURPLE, background: "#ece6fa", border: "1.5px solid #cfc4f3", borderRadius: 8, padding: "1px 7px", whiteSpace: "nowrap" }}>Muse</span>}
							{!t.committed && f > T.deadline + 10 && <span style={{ fontSize: 13, fontWeight: 800, color: AMBER, whiteSpace: "nowrap" }}>one agent said no</span>}
						</div>
					</div>
				);
			})}

			{/* tentative label under the stack */}
			<div style={{ position: "absolute", left: ORIGIN_X, top: ORIGIN_Y + 66 + 4 * ROW_H + 2, fontSize: 18, fontWeight: 700, color: "#7a7592", opacity: range(f, T.first + 60, T.first + 80) * (1 - range(f, T.deadline, T.deadline + 14)) }}>
				dashed = tentative until the deadline
			</div>
		</AbsoluteFill>
	);
}
