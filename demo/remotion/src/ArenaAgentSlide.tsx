import React from "react";
import {
	AbsoluteFill,
	interpolate,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import { AgentCharacter } from "../../../src/ui/web/AgentCharacter";
import "./video.css";

hljs.registerLanguage("json", json);

// Excerpt of profiles/example.json, text shortened for readability.
const CODE = `{
  "instructions": "Prefer small, polished demos…",
  "notes": [
    { "text": "Likes shipping small demos…", "level": 1 },
    { "text": "Has led two hackathon teams before.", "level": 2 },
    { "text": "Burned out on crypto…", "level": "never" }
  ]
}`;

// hljs never lets a token span cross a newline in JSON, so lines split safely.
const LINES = hljs.highlight(CODE, { language: "json" }).value.split("\n");

// Timeline (30 fps).
const T = {
	card: 36,
	firstLine: 18,
	lineGap: 7,
	grokbot: 170,
	muse: 196,
	bubble: 228,
};

const INK = "#2a2a3c";
const PURPLE = "#5b4b9a";

const css = `
.slide { font-family: "DM Sans", sans-serif; color: ${INK}; background: #f6f5fc;
  background-image: radial-gradient(#d9d5ee 2.5px, transparent 2.5px); background-size: 40px 40px; }
.slide .eyebrow { font-size: 26px; letter-spacing: .04em; text-transform: uppercase; color: ${PURPLE}; font-weight: 500; }
.slide h1 { font-size: 92px; line-height: 1.05; font-weight: 400; margin: 14px 0 0; letter-spacing: -.01em; }
.code-window { background: #0d1117; border-radius: 26px; overflow: hidden;
  box-shadow: 0 40px 80px -30px rgba(40,30,90,.55), 0 0 0 1px rgba(255,255,255,.06) inset; }
.code-bar { display: flex; align-items: center; gap: 12px; padding: 20px 26px; background: #161b22; border-bottom: 1px solid #21262d; }
.code-bar i { width: 16px; height: 16px; border-radius: 50%; display: block; }
.code-bar span { margin-left: 14px; font: 500 20px "JetBrains Mono", ui-monospace, Menlo, monospace; color: #7d8590; }
.code-body { padding: 30px 0 34px; font: 400 22px/1.7 "JetBrains Mono", ui-monospace, Menlo, monospace; color: #e6edf3; }
.code-line { display: flex; overflow: hidden; padding: 0 34px; white-space: pre; border-left: 4px solid transparent; }
.code-no { width: 44px; flex: none; color: #484f58; user-select: none; }
.hljs-attr { color: #79c0ff; }
.hljs-string { color: #a5d6a7; }
.hljs-number { color: #ffa657; }
.hljs-punctuation { color: #8b949e; }
.hljs-literal { color: #ff7b72; }
.caret { display: inline-block; width: 14px; height: 32px; margin-left: 2px; vertical-align: -6px; background: #79c0ff; }
.agent-card { background: #ece6fa; border: 2px solid #ddd3f5; border-radius: 26px; padding: 44px 48px; }
.agent-card .eyebrow { font-size: 22px; }
.agent-card h2 { font-size: 58px; line-height: 1.1; font-weight: 400; margin: 14px 0 22px; }
.agent-card p { font-size: 29px; line-height: 1.45; color: #5d5878; font-weight: 600; margin: 0; }
.chip { display: inline-block; border-radius: 999px; padding: 6px 18px; font-size: 24px; font-weight: 700; margin: 0 10px 10px 0; }
.bubble { position: relative; background: #fff; border: 2px solid #ddd3f5; border-radius: 22px; padding: 18px 28px;
  font-size: 32px; font-weight: 600; color: ${INK}; box-shadow: 0 14px 30px -14px rgba(60,40,120,.35); }
.bubble::before { content: ""; position: absolute; left: -14px; bottom: 26px; width: 24px; height: 24px; background: #fff;
  border-left: 2px solid #ddd3f5; border-bottom: 2px solid #ddd3f5; transform: rotate(45deg); }
.bubble b { color: ${PURPLE}; }
`;

function Grokbot({ width = 150, height = 188 }: { width?: number; height?: number }) {
	return (
		<svg viewBox="0 0 160 200" width={width} height={height} aria-hidden="true">
			<ellipse cx="80" cy="184" rx="51" ry="8" fill="#33345a" opacity=".13" />
			{/* antenna */}
			<path d="M80 34 L80 14" stroke="#2b2f3a" strokeWidth="5" strokeLinecap="round" />
			<circle cx="80" cy="11" r="7" fill="#e8e8f0" stroke="#2b2f3a" strokeWidth="3" />
			{/* arms and feet */}
			<g fill="#1b1e27">
				<ellipse cx="27" cy="120" rx="12" ry="24" transform="rotate(18 27 120)" />
				<ellipse cx="133" cy="120" rx="12" ry="24" transform="rotate(-18 133 120)" />
				<ellipse cx="58" cy="174" rx="17" ry="11" />
				<ellipse cx="102" cy="174" rx="17" ry="11" />
			</g>
			{/* body */}
			<rect x="27" y="32" width="106" height="142" rx="46" fill="#232734" />
			<rect x="27" y="32" width="106" height="142" rx="46" fill="none" stroke="#3a4052" strokeWidth="2" />
			<ellipse cx="48" cy="52" rx="8" ry="14" transform="rotate(32 48 52)" fill="#fff" opacity=".12" />
			{/* visor */}
			<rect x="42" y="60" width="76" height="44" rx="22" fill="#0b0d13" stroke="#454c61" strokeWidth="2" />
			<ellipse cx="63" cy="82" rx="7" ry="8" fill="#f2f4ff" />
			<ellipse cx="97" cy="82" rx="7" ry="8" fill="#f2f4ff" />
			<circle cx="65" cy="79" r="2.4" fill="#0b0d13" />
			<circle cx="99" cy="79" r="2.4" fill="#0b0d13" />
			{/* slashed-circle mark on chest */}
			<g fill="none" stroke="#f2f4ff" strokeWidth="5" strokeLinecap="round">
				<circle cx="80" cy="136" r="15" />
				<path d="M64 154 L96 118" />
			</g>
			<text x="80" y="168" textAnchor="middle" fill="#9aa1b8" fontSize="11" fontWeight="600">
				Grokbot
			</text>
		</svg>
	);
}

function PopIn({
	at,
	children,
	from = 60,
}: {
	at: number;
	children: React.ReactNode;
	from?: number;
}) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const p = spring({
		frame: frame - at,
		fps,
		config: { damping: 11, stiffness: 140, mass: 0.7 },
	});
	return (
		<div
			style={{
				transform: `translateY(${(1 - p) * from}px) scale(${0.5 + 0.5 * p})`,
				opacity: Math.min(1, p * 3),
				transformOrigin: "50% 100%",
			}}
		>
			{children}
		</div>
	);
}

export function ArenaAgentSlide() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const rise = (start: number, dur = 18) =>
		interpolate(frame, [start, start + dur], [0, 1], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
	const cardIn = spring({ frame: frame - T.card, fps, config: { damping: 16 } });
	const lastLine = T.firstLine + (LINES.length - 1) * T.lineGap;
	const showCaret = frame < lastLine + 40 && Math.floor(frame / 15) % 2 === 0;
	const bob = (offset: number) => Math.sin((frame + offset) / 14) * 5;

	return (
		<AbsoluteFill className="slide app-insert">
			<style>{css}</style>
			<div style={{ position: "absolute", left: 150, top: 96, right: 150 }}>
				<div style={{ opacity: rise(0), transform: `translateY(${(1 - rise(0)) * 16}px)` }}>
					<div className="eyebrow">People / Start from the example</div>
					<h1>Create an arena agent</h1>
				</div>
			</div>

			<div
				style={{
					position: "absolute",
					left: 150,
					right: 150,
					top: 310,
					display: "grid",
					gridTemplateColumns: "1.6fr 1fr",
					gap: 48,
					alignItems: "start",
				}}
			>
				<div
					className="code-window"
					style={{
						opacity: rise(8),
						transform: `translateY(${(1 - rise(8, 24)) * 30}px)`,
					}}
				>
					<div className="code-bar">
						<i style={{ background: "#ff5f57" }} />
						<i style={{ background: "#febc2e" }} />
						<i style={{ background: "#28c840" }} />
						<span>profiles/you.json</span>
					</div>
					<div className="code-body">
						{LINES.map((html, i) => {
							const at = T.firstLine + i * T.lineGap;
							const p = rise(at, 10);
							const isNote = html.includes("&quot;text&quot;");
							const glow = isNote
								? interpolate(
										frame,
										[lastLine + 20 + (i - 3) * 14, lastLine + 34 + (i - 3) * 14],
										[0, 1],
										{ extrapolateLeft: "clamp", extrapolateRight: "clamp" },
									)
								: 0;
							return (
								<div
									key={i}
									className={`code-line${html.includes("never") ? " never" : ""}`}
									style={{
										opacity: p,
										transform: `translateX(${(1 - p) * -18}px)`,
										background: `rgba(121,192,255,${0.09 * glow})`,
										borderLeftColor: `rgba(121,192,255,${glow})`,
									}}
								>
									<span className="code-no">{i + 1}</span>
									<span dangerouslySetInnerHTML={{ __html: html }} />
									{i === Math.min(LINES.length - 1, Math.max(0, Math.floor((frame - T.firstLine) / T.lineGap))) &&
										showCaret && <span className="caret" />}
								</div>
							);
						})}
					</div>
				</div>

				<div
					className="agent-card"
					style={{
						opacity: Math.min(1, cardIn * 2),
						transform: `translateY(${(1 - cardIn) * 40}px)`,
					}}
				>
					<div className="eyebrow">Arena agent</div>
					<h2>Give it a point of view</h2>
					<p>
						Set standing instructions. Tag notes with a disclosure level or mark
						them never.
					</p>
					<div style={{ marginTop: 28, opacity: rise(T.card + 30) }}>
						<span className="chip" style={{ background: "#dcd3f7", color: PURPLE }}>
							level 1
						</span>
						<span className="chip" style={{ background: "#c9bdf2", color: "#463982" }}>
							level 2
						</span>
						<span className="chip" style={{ background: "#3b2f5c", color: "#f1ecff" }}>
							never
						</span>
					</div>
				</div>
			</div>

			{/* Mascots pop up one by one, then the invitation. */}
			<div
				style={{
					position: "absolute",
					left: 150,
					right: 150,
					bottom: 24,
					display: "flex",
					alignItems: "flex-end",
					gap: 26,
				}}
			>
				<PopIn at={T.grokbot}>
					<div style={{ transform: `translateY(${bob(0)}px)` }}>
						<Grokbot />
					</div>
				</PopIn>
				<PopIn at={T.muse}>
					<div style={{ transform: `translateY(${bob(20)}px)` }}>
						<AgentCharacter muse mood="idle" width={150} height={188} />
					</div>
				</PopIn>
				<div style={{ marginBottom: 56 }}>
					<PopIn at={T.bubble} from={20}>
						<div className="bubble">
							…or <b>connect your personal agent</b>
						</div>
					</PopIn>
				</div>
			</div>
		</AbsoluteFill>
	);
}
