import React from "react";
import { MessagesSquare } from "lucide-react";
import { agentLabel as name, IdeaCard } from "./IdeaCard.js";
import type { teamStory, TeamStep } from "./replay.js";

const list = (ids: string[]) => ids.map(name).join(", ");
// What a step says, as a sentence.
function sentence(step: TeamStep): string {
	const who = name(step.who);
	switch (step.what) {
		case "offered":
			return `${who} offered a place to ${list(step.others)}`;
		case "led":
			return `${who} chose to lead this team over joining ${list(step.others)}`;
		case "joined":
			return `${who} joined the team`;
		case "declined":
			return `${who} declined the offer`;
		case "busy":
			return `${who} was busy with offers of their own`;
		case "stayed":
			return `${who} stayed after the team grew`;
		case "left":
			return `${who} left the team`;
	}
}
const good = new Set<TeamStep["what"]>(["joined", "stayed"]);

// How a team came about, under its card: the idea as it changed in the conversation that founded the team,
// with each side's private reasoning folded away, then each offer, answer, and re-check. Follows the replay.
export function TeamStory({
	story,
	members,
	onOpenConversation,
}: {
	story: ReturnType<typeof teamStory>;
	members: string[];
	onOpenConversation: (a: string, b: string) => void;
}) {
	const { owner, founder, idea, steps } = story;
	return (
		<div className="team-story">
			{founder && idea.versions.length > 0 && (
				<>
					<div className="detail-label">HOW THE IDEA FORMED</div>
					<p className="team-story-note">
						In {name(owner)}’s conversation with {name(founder)}
					</p>
					<IdeaCard {...idea} showWhy />
				</>
			)}
			<div className="detail-label">HOW THE TEAM CAME TOGETHER</div>
			<ol className="team-steps">
				{steps.map((step, i) => (
					<li key={i}>
						<span className={good.has(step.what) ? "good" : ""}>
							{sentence(step)}
						</span>
						{step.why && (
							<details className="idea-why">
								<summary>Private reasoning</summary>
								<p>{step.why}</p>
							</details>
						)}
					</li>
				))}
			</ol>
			<div className="team-story-links">
				{members
					.filter((id) => id !== owner)
					.map((id) => (
						<button
							key={id}
							className="button"
							onClick={() => onOpenConversation(owner, id)}
						>
							<MessagesSquare size={14} /> {name(owner)} and{" "}
							{name(id)}’s conversation
						</button>
					))}
			</div>
		</div>
	);
}
