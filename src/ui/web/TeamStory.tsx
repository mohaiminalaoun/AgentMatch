import React, { useMemo } from "react";
import { Eye, MessagesSquare } from "lucide-react";
import { AgentCharacter } from "./AgentCharacter.js";
import { agentLabel as name, Reasoning } from "./IdeaCard.js";
import { IdeaTimeline } from "./IdeaTimeline.js";
import type { Event, teamStory, TeamStep } from "./replay.js";
import {
	ideaTimeline,
	roleName,
	teamSection,
	type TeamMember,
} from "./timeline.js";

type Team = Extract<Event, { type: "team" }>["team"];
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
		case "confirmed":
			return `${who} confirmed the group at the deadline`;
		case "dropped":
			return `${who} dropped out at the deadline`;
	}
}
const good = new Set<TeamStep["what"]>(["joined", "stayed", "confirmed"]);
const stepWhy: Record<TeamStep["what"], string> = {
	offered: "offered places",
	led: "chose to lead",
	joined: "joined",
	declined: "declined",
	busy: "was busy",
	stayed: "stayed",
	left: "left",
	confirmed: "confirmed",
	dropped: "dropped out",
};

// How a member came to the team, in a line, from facts in the log.
function originLine(m: TeamMember, owner: string): string {
	switch (m.origin.kind) {
		case "owner":
			return m.led
				? "Owns the project and chose to lead it rather than join another team."
				: "Owns the project.";
		case "founder":
			return m.origin.versions > 1
				? `Shaped the idea with ${name(owner)} over ${m.origin.versions} versions.`
				: "Took the idea as pitched.";
		case "joiner":
			return m.origin.agreed
				? `Joined the idea as it stood. Their own conversation with ${name(owner)} had agreed on “${
						m.origin.agreed.title ?? m.origin.agreed.pitch
					}”.`
				: "Joined the team’s version.";
	}
}

// How a team came about, under its card, in two parts: how its idea evolved in the conversation that founded
// it, and how the team formed around it (members, then every offer, answer, and re-check). Private reasoning
// shows only in the operator's private view. Follows the replay.
export function TeamStory({
	story,
	team,
	events,
	showPrivate,
	onTogglePrivate,
	colorOf,
	onOpenConversation,
}: {
	story: ReturnType<typeof teamStory>;
	team: Team;
	events: Event[];
	showPrivate: boolean;
	onTogglePrivate: () => void;
	colorOf: (id: string) => string;
	onOpenConversation: (a: string, b: string) => void;
}) {
	const { owner, founder, idea } = story;
	const timeline = useMemo(() => ideaTimeline(idea, team), [idea, team]);
	const section = useMemo(
		() => teamSection(events, story, team, timeline),
		[events, story, team, timeline],
	);
	const filledBy =
		team.roles &&
		Object.fromEntries(
			Object.entries(team.roles).map(([id, role]) => [role, id]),
		);
	const jump = (n: number) =>
		document
			.getElementById(`${team.id}-v${n}`)
			?.scrollIntoView({ behavior: "smooth", block: "nearest" });
	return (
		<div className="team-story">
			<div className="private-toggle">
				<Eye size={14} />
				<span>Operator’s private view</span>
				<button
					role="switch"
					aria-checked={showPrivate}
					aria-label="Show private rationales"
					className={showPrivate ? "toggle on" : "toggle"}
					onClick={onTogglePrivate}
				>
					<span />
				</button>
			</div>
			<p className="private-notice">
				{showPrivate
					? "Private rationales are for the operator. Other agents do not see them."
					: "Private reasoning is hidden. Turn on the operator’s private view to read each agent’s own words."}
			</p>
			{founder && timeline.nodes.length > 0 && (
				<section>
					<div className="detail-label">HOW THE IDEA EVOLVED</div>
					<IdeaTimeline
						timeline={timeline}
						owner={owner}
						founder={founder}
						status={team.status}
						anchorPrefix={team.id}
						filledBy={filledBy}
						showPrivate={showPrivate}
					/>
				</section>
			)}
			<section>
				<div className="detail-label team-formed-label">
					HOW THE TEAM FORMED
					{section.rolesCovered !== undefined && (
						<span
							className={`roles-covered${section.rolesCovered ? "" : " open"}`}
						>
							{section.rolesCovered
								? "All roles covered"
								: "Roles still open"}
						</span>
					)}
				</div>
				<ul className="team-members">
					{section.members.map((m) => (
						<li key={m.id}>
							<AgentCharacter
								color={colorOf(m.id)}
								width={30}
								height={38}
							/>
							<div>
								<p className="member-name">
									{name(m.id)}
									{m.owner && (
										<span className="member-badge">
											Idea owner
										</span>
									)}
									{m.led && (
										<span className="member-badge">
											Led
										</span>
									)}
									{!m.owner && (
										<span className="member-badge">
											Joined
										</span>
									)}
									{m.role && (
										<span className="member-role">
											Covers {roleName(m.role)}
										</span>
									)}
								</p>
								<p className="member-origin">
									{originLine(m, owner)}
									{m.origin.kind === "joiner" &&
										m.origin.agreed && (
											<>
												{" "}
												<button
													type="button"
													className="link-button"
													onClick={() =>
														onOpenConversation(
															owner,
															m.id,
														)
													}
												>
													Open that conversation
												</button>
											</>
										)}
								</p>
							</div>
						</li>
					))}
				</ul>
				<ol className="team-steps">
					{section.steps.map((step, i) => (
						<li key={i}>
							<span className={good.has(step.what) ? "good" : ""}>
								{sentence(step)}
							</span>
							{step.version !== undefined && (
								<>
									{" · "}
									<button
										type="button"
										className="link-button step-version"
										onClick={() => jump(step.version!)}
									>
										on v{step.version}
									</button>
								</>
							)}
							<Reasoning
								heading={`Why ${name(step.who)} ${stepWhy[step.what]}`}
								text={step.why}
								show={showPrivate}
							/>
						</li>
					))}
				</ol>
			</section>
			<div className="team-story-links">
				{team.members
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
