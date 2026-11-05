import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { AgentCharacter } from "../../../src/ui/web/AgentCharacter";
import { IdeaTimeline } from "../../../src/ui/web/IdeaTimeline";
import { ideaTimeline } from "../../../src/ui/web/timeline";
import data from "./public-project";
import "../../../src/ui/web/style.css";
import "./video.css";

const versions = data.versions;
const filledBy = Object.fromEntries(
	Object.entries(data.team.roles ?? {}).map(([id, role]) => [role, id]),
);
// Only framing and camera movement are video-specific. All visible UI below is
// rendered by existing application components with their original stylesheet.
function Frame({
	children,
	width = 900,
	scale = 1.7,
	pan = 0,
}: {
	children: React.ReactNode;
	width?: number;
	scale?: number;
	pan?: number;
}) {
	return (
		<AbsoluteFill
			className="app-insert"
			style={{
				background: "#f7f8fa",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<div
				style={{
					width,
					transform: `translateY(${pan}px) scale(${scale})`,
					transformOrigin: "center",
				}}
			>
				{children}
			</div>
		</AbsoluteFill>
	);
}
export function StagedDisclosure() {
	const f = useCurrentFrame();
	const level = Math.min(3, Math.floor(f / 110));
	return (
		<Frame width={260} scale={2.5}>
			<AgentCharacter
				color="#28bbae"
				level={level}
				mood={level === 3 ? "matched" : "idle"}
				sprout
				badge="M"
				width={260}
				height={325}
			/>
		</Frame>
	);
}
export function ProjectEvolution() {
	const f = useCurrentFrame();
	const visible = versions.slice(0, f < 150 ? 1 : 2);
	const agreed = f >= 330 ? data.agreed : undefined;
	const timeline = ideaTimeline(
		{ versions: visible, agreed },
		f >= 440 ? data.team : undefined,
	);
	const pan = interpolate(f, [0, 180, 430, 539], [100, 100, -130, -130], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	return (
		<Frame width={960} scale={1.65} pan={pan}>
			<IdeaTimeline
				timeline={timeline}
				owner={data.owner}
				founder={data.founder!}
				status={f >= 440 ? data.team.status : "tentative"}
				anchorPrefix="recorded-project"
				filledBy={f >= 440 ? filledBy : undefined}
				showPrivate={false}
			/>
		</Frame>
	);
}
export function ResultCard() {
	const timeline = ideaTimeline({ versions, agreed: data.agreed }, data.team);
	return (
		<Frame width={960} scale={1.4}>
			<IdeaTimeline
				timeline={timeline}
				owner={data.owner}
				founder={data.founder!}
				status={data.team.status}
				anchorPrefix="confirmed-project"
				filledBy={filledBy}
				showPrivate={false}
			/>
		</Frame>
	);
}
