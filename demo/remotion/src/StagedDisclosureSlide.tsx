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

const LEVEL_FRAMES = 110;
const PURPLE = "#5b4b9a";
const INK = "#2a2a3c";

const LEVELS = [
	{ tag: "L0", title: "Start with an idea.", sub: "Public project pitch", share: ["Project pitch"] },
	{ tag: "L1", title: "Find common ground.", sub: "Interests and availability", share: ["Interests", "Availability"] },
	{ tag: "L2", title: "See what you can build.", sub: "Skills and team preferences", share: ["Skills", "Team preferences"] },
	{ tag: "L3", title: "Names come last.", sub: "Identity after commitment", share: ["Name"] },
];

// What the agent tries to send too early at each level, and when it unlocks.
const BLOCKS: Record<number, { field: string; unlocks: string } | undefined> = {
	0: { field: "Interests", unlocks: "L1" },
	1: { field: "Skills", unlocks: "L2" },
	2: { field: "Name", unlocks: "L3" },
};
const BLOCK_AT = 58;

const css = `
.sd { font-family: "DM Sans", sans-serif; color: ${INK}; background: #f6f5fc;
  background-image: radial-gradient(#d9d5ee 2.5px, transparent 2.5px); background-size: 40px 40px; }
.sd .eyebrow { font-size: 26px; letter-spacing: .14em; text-transform: uppercase; color: ${PURPLE}; font-weight: 700; }
.sd .tag { font-size: 40px; font-weight: 800; color: ${PURPLE}; letter-spacing: .04em; }
.sd .h1 { color: #2a2a3c; font-size: 88px; line-height: 1.05; font-weight: 600; margin: 0; letter-spacing: -.02em; }
.sd .sub { font-size: 38px; color: #6a6682; font-weight: 500; }
.sd .word { display: inline-block; margin-right: .26em; }
.share { background: #fff; border: 2px solid #e4def7; border-radius: 28px; padding: 34px 38px; width: 430px;
  box-shadow: 0 30px 60px -34px rgba(60,40,120,.35); }
.share h3 { margin: 0 0 22px; font-size: 22px; letter-spacing: .12em; text-transform: uppercase; color: ${PURPLE}; }
.share-row { display: flex; align-items: center; gap: 16px; font-size: 32px; font-weight: 600; padding: 9px 0; }
.attempt { margin-top: 44px; display: flex; align-items: center; gap: 18px; font-size: 30px; font-weight: 600; }
.attempt .lbl { color: #6a6682; }
.attempt .chip { background: #fff; border: 2px solid #ddd3f5; border-radius: 14px; padding: 8px 20px; color: ${INK}; }
.stamp { margin-top: 18px; display: inline-flex; align-items: center; gap: 14px; background: #fdebec; border: 2px solid #f3b4b8;
  color: #b4232f; border-radius: 16px; padding: 12px 24px; font-size: 30px; font-weight: 700; }
.dot { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; flex: none; font-size: 20px; }
`;

const range = (f: number, a: number, b: number, easing = Easing.out(Easing.cubic)) =>
	interpolate(f, [a, b], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
		easing,
	});

function Words({ text, local }: { text: string; local: number }) {
	return (
		<div className="h1">
			{text.split(" ").map((w, i) => {
				const p = range(local, 8 + i * 5, 24 + i * 5);
				return (
					<span
						key={i}
						className="word"
						style={{
							opacity: p,
							transform: `translateY(${(1 - p) * 44}px)`,
							filter: `blur(${(1 - p) * 10}px)`,
						}}
					>
						{w}
					</span>
				);
			})}
		</div>
	);
}

function Lock({ color = "#a49fc0" }: { color?: string }) {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
			<rect x="5" y="11" width="14" height="10" rx="2.5" fill={color} fillOpacity=".25" />
			<path d="M8 11V8a4 4 0 0 1 8 0v3" />
		</svg>
	);
}

function GateBlock({ level, local }: { level: number; local: number }) {
	const { fps } = useVideoConfig();
	const b = BLOCKS[level];
	if (!b) return null;
	const chip = range(local, BLOCK_AT, BLOCK_AT + 14);
	const hit = spring({ frame: local - (BLOCK_AT + 20), fps, config: { damping: 9, stiffness: 220, mass: 0.5 } });
	const shake = local > BLOCK_AT + 20 && local < BLOCK_AT + 34 ? Math.sin(local * 2.4) * (BLOCK_AT + 34 - local) * 0.9 : 0;
	return (
		<div>
			<div className="attempt" style={{ opacity: chip, transform: `translateX(${(1 - chip) * -40 + shake}px)` }}>
				<span className="lbl">Agent tries to send</span>
				<span className="chip">{b.field}</span>
			</div>
			<div className="stamp" style={{ opacity: Math.min(1, hit * 2), transform: `scale(${0.7 + 0.3 * hit}) translateX(${shake}px)`, transformOrigin: "0 50%" }}>
				<span>✕</span>
				<span>Blocked by the gate, not before {b.unlocks}</span>
			</div>
		</div>
	);
}

function LevelText({ level, local }: { level: number; local: number }) {
	const L = LEVELS[level]!;
	const out = range(local, LEVEL_FRAMES - 12, LEVEL_FRAMES, Easing.in(Easing.cubic));
	const tag = range(local, 0, 16);
	const sub = range(local, 30, 48);
	return (
		<div style={{ opacity: 1 - out, transform: `translateY(${-out * 30}px)` }}>
			<div
				className="tag"
				style={{ opacity: tag, transform: `translateX(${(1 - tag) * -30}px)` }}
			>
				{L.tag}
			</div>
			<Words text={L.title} local={local} />
			<div
				className="sub"
				style={{ marginTop: 26, opacity: sub, transform: `translateY(${(1 - sub) * 20}px)` }}
			>
				{L.sub}
			</div>
			<GateBlock level={level} local={local} />
		</div>
	);
}

export function StagedDisclosureSlide() {
	const f = useCurrentFrame();
	const { fps } = useVideoConfig();
	const level = Math.min(3, Math.floor(f / LEVEL_FRAMES));
	const local = f - level * LEVEL_FRAMES;
	const intro = range(f, 0, 20);
	const bounce = spring({
		frame: local,
		fps,
		config: { damping: 7, stiffness: 160, mass: 0.6 },
	});
	const scale = level === 0 && f < 20 ? 0.9 + 0.1 * intro : 1 + (1 - bounce) * -0.06 + 0.0;
	const float = Math.sin(f / 16) * 8;

	return (
		<AbsoluteFill className="sd app-insert">
			<style>{css}</style>

			<div style={{ position: "absolute", left: 150, top: 150, opacity: intro }}>
				<div className="eyebrow">Staged disclosure</div>
			</div>

			<div style={{ position: "absolute", left: 150, top: 330, width: 760 }}>
				<LevelText key={level} level={level} local={local} />
			</div>

			{/* character */}
			<div
				style={{
					position: "absolute",
					left: 960,
					top: 150,
					width: 380,
					transform: `translateY(${float}px) scale(${scale})`,
					transformOrigin: "50% 90%",
					opacity: intro,
				}}
			>
				<AgentCharacter
					color="#28bbae"
					level={level}
					mood={level === 3 && local > 14 ? "matched" : "idle"}
					sprout
					badge="M"
					width={380}
					height={475}
				/>
			</div>

			{/* shared so far */}
			<div style={{ position: "absolute", right: 130, top: 270, opacity: intro }}>
				<div className="share">
					<h3>Shared so far</h3>
					{LEVELS.map((L, li) =>
						L.share.map((s, si) => {
							const at = li * LEVEL_FRAMES + 18 + si * 8;
							const p = range(f, at, at + 14);
							const done = f >= at;
							const hitAt = level * LEVEL_FRAMES + BLOCK_AT + 20;
							const blocked = BLOCKS[level]?.field === s && f >= hitAt && f < hitAt + 34;
							const rowShake = blocked ? Math.sin(f * 2.4) * (hitAt + 34 - f) * 0.7 : 0;
							return (
								<div
									key={s}
									className="share-row"
									style={{
										color: done ? INK : blocked ? "#b4232f" : "#b7b2cc",
										transform: `translateX(${rowShake}px)`,
									}}
								>
									<span
										className="dot"
										style={{
											background: done ? "#28bbae" : blocked ? "#fbd5d8" : "#ece8f8",
											color: "#fff",
											transform: `scale(${done ? 1 + (1 - p) * 0.6 : 1})`,
										}}
									>
										{done ? "✓" : <Lock color={blocked ? "#b4232f" : "#a49fc0"} />}
									</span>
									<span
										style={{
											transform: `translateX(${done ? (1 - p) * 14 : 0}px)`,
										}}
									>
										{s}
									</span>
								</div>
							);
						}),
					)}
				</div>
			</div>

			{/* stepper */}
			<div
				style={{
					position: "absolute",
					left: 150,
					right: 150,
					bottom: 90,
					display: "flex",
					gap: 18,
					opacity: intro,
				}}
			>
				{LEVELS.map((L, i) => {
					const fill = range(f, i * LEVEL_FRAMES, (i + 1) * LEVEL_FRAMES, Easing.linear);
					return (
						<div key={i} style={{ flex: 1 }}>
							<div
								style={{
									height: 8,
									borderRadius: 4,
									background: "#e1dcf3",
									overflow: "hidden",
								}}
							>
								<div
									style={{
										height: "100%",
										width: `${fill * 100}%`,
										background: PURPLE,
									}}
								/>
							</div>
							<div
								style={{
									marginTop: 12,
									fontSize: 24,
									fontWeight: 700,
									color: i <= level ? PURPLE : "#b3adca",
								}}
							>
								{L.tag}
							</div>
						</div>
					);
				})}
			</div>
		</AbsoluteFill>
	);
}
