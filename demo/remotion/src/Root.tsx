import React from "react";
import { Composition, Sequence } from "remotion";
import { StagedDisclosure, ProjectEvolution, ResultCard } from "./Scenes";
import { ArenaAgentSlide } from "./ArenaAgentSlide";
import { StagedDisclosureSlide } from "./StagedDisclosureSlide";
import { CommitmentSlide } from "./CommitmentSlide";
import { ArenaPrivacy, ARENA_PRIVACY_FRAMES } from "./ArenaPrivacySlide";
import { EvalHarness, EVAL_HARNESS_FRAMES } from "./EvalHarnessSlide";
import { TeamsOverlay, TEAMS_OVERLAY_FRAMES } from "./TeamsOverlay";
const Reel = () => (
	<>
		<Sequence durationInFrames={450}>
			<StagedDisclosure />
		</Sequence>
		<Sequence from={450} durationInFrames={540}>
			<ProjectEvolution />
		</Sequence>
		<Sequence from={990} durationInFrames={240}>
			<ResultCard />
		</Sequence>
	</>
);
export const RemotionRoot = () => (
	<>
		<Composition
			id="StagedDisclosure"
			component={StagedDisclosure}
			durationInFrames={450}
			fps={30}
			width={1920}
			height={1080}
		/>
		<Composition
			id="ProjectEvolution"
			component={ProjectEvolution}
			durationInFrames={540}
			fps={30}
			width={1920}
			height={1080}
		/>
		<Composition
			id="ResultCard"
			component={ResultCard}
			durationInFrames={240}
			fps={30}
			width={1920}
			height={1080}
		/>
		<Composition
			id="ArenaAgentSlide"
			component={ArenaAgentSlide}
			durationInFrames={330}
			fps={30}
			width={1920}
			height={1080}
		/>
		<Composition
			id="StagedDisclosureSlide"
			component={StagedDisclosureSlide}
			durationInFrames={450}
			fps={30}
			width={1920}
			height={1080}
		/>
		<Composition
			id="CommitmentSlide"
			component={CommitmentSlide}
			durationInFrames={420}
			fps={30}
			width={1920}
			height={1080}
		/>
		<Composition
			id="ArenaPrivacy"
			component={ArenaPrivacy}
			durationInFrames={ARENA_PRIVACY_FRAMES}
			fps={30}
			width={1920}
			height={1080}
		/>
		<Composition
			id="EvalHarness"
			component={EvalHarness}
			durationInFrames={EVAL_HARNESS_FRAMES}
			fps={30}
			width={1920}
			height={1080}
		/>
		<Composition
			id="TeamsOverlay"
			component={TeamsOverlay}
			durationInFrames={TEAMS_OVERLAY_FRAMES}
			fps={30}
			width={1920}
			height={1080}
			defaultProps={{ preview: false }}
		/>
		<Composition
			id="AllInserts"
			component={Reel}
			durationInFrames={1230}
			fps={30}
			width={1920}
			height={1080}
		/>
	</>
);
