import React, { useEffect, useRef } from "react";
import {
	agentLabel as name,
	CardDetails,
	Outcome,
	PitchChange,
	Reasoning,
	RoleCards,
	RoleChips,
} from "./IdeaCard.js";
import type { IdeaVersion, OfferStep } from "./replay.js";
import {
	shortId,
	stepVerb,
	type IdeaTimeline as Timeline,
	type TimelineNode,
} from "./timeline.js";

// What the sender of a version did, as the node's heading says it.
const did: Record<IdeaVersion["how"], string> = {
	proposal: "proposed it",
	join: "asked to join it",
	counter: "countered with a new version",
	revision: "reshaped it",
	offer: "offered it as the team’s project",
};
// What the sender's reasoning was for, and what the answerer's was for.
const sentWhy: Record<IdeaVersion["how"], string> = {
	proposal: "proposed it",
	join: "asked to join",
	counter: "countered",
	revision: "reshaped it",
	offer: "offered it",
};
const answerWhy: Record<IdeaVersion["status"], string | undefined> = {
	open: undefined,
	accepted: "accepted",
	declined: "declined",
	countered: "countered",
	adopted: "adopted it",
	kept: "kept the earlier version",
	committed: "joined",
	busy: "was busy",
};
const offerAnswer = (o: OfferStep) =>
	o.status === "committed"
		? `${name(o.to)} joined the team`
		: o.status === "busy"
			? `${name(o.to)} was busy with offers of their own`
			: o.status === "declined"
				? `${name(o.to)} declined`
				: `Waiting for ${name(o.to)}`;
const badgeText: Record<Timeline["badge"], string> = {
	"never changed": "Never changed",
	"the team's project": "Team’s project",
	"agreed now": "Agreed now",
	"still on the table": "Still on the table",
};
const sameCard = (a: unknown, b: unknown) =>
	JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});

// One version on the rail: who sent it and what changed, both sides' reasoning (in the private view), what
// the other side did, and the offers that carried it. The chosen version is the one rendered in full.
function Node({
	node,
	timeline,
	anchor,
	filledBy,
	showPrivate,
}: {
	node: TimelineNode;
	timeline: Timeline;
	anchor: string;
	filledBy: Record<string, string> | undefined;
	showPrivate: boolean;
}) {
	const { v, before, n, state } = node;
	const chosen = state === "chosen";
	const heading =
		n > 1 && v.how === "proposal"
			? `${name(v.from)} proposed a new idea`
			: n === 1 || v.how === "join"
				? v.how === "join"
					? `${name(v.from)} asked to join ${name(v.author)}’s idea`
					: `Started as ${name(v.author)}’s idea`
				: `${name(v.from)} ${did[v.how]}`;
	const card = v.card;
	const hasCard = Boolean(card.problem || card.build || card.roleWork);
	const answered = answerWhy[v.status];
	return (
		<li className={`timeline-node ${state}`} id={anchor}>
			<span className="timeline-marker">v{n}</span>
			<div className="timeline-body">
				<div className="timeline-head">
					<span>{heading}</span>
					{chosen && (
						<span className="timeline-tag chosen">
							{badgeText[timeline.badge]}
						</span>
					)}
					{state === "superseded" && (
						<span className="timeline-tag">
							{node.replacedBy
								? `Replaced by v${node.replacedBy}`
								: "Replaced"}
						</span>
					)}
					{state === "not-adopted" && (
						<span className="timeline-tag muted">Not adopted</span>
					)}
				</div>
				{node.title && (!before || node.renamed || chosen) && (
					<p className="idea-title">{node.title}</p>
				)}
				<PitchChange pitch={v.pitch} change={node.pitch} />
				{chosen ? (
					<>
						<CardDetails card={card} roles={[]} />
						<RoleCards
							roles={v.rolesNeeded}
							card={card}
							heading={
								filledBy
									? "WHO FILLS EACH ROLE"
									: "ROLES THIS PROJECT NEEDS"
							}
							filledBy={filledBy}
						/>
					</>
				) : (
					<>
						<RoleChips roles={node.roles} />
						{hasCard && !sameCard(card, before?.card) && (
							<details className="timeline-card">
								<summary>
									{before
										? "What changed in the problem & weekend build"
										: "Problem & weekend build"}
								</summary>
								<CardDetails
									card={card}
									roles={v.rolesNeeded}
									before={before?.card}
									compact
								/>
							</details>
						)}
					</>
				)}
				<Reasoning
					heading={`Why ${name(v.from)} ${sentWhy[v.how]}`}
					text={v.why}
					show={showPrivate}
				/>
				<Outcome v={v} />
				{answered && (
					<Reasoning
						heading={`Why ${name(v.to)} ${answered}`}
						text={v.answerWhy}
						show={showPrivate}
					/>
				)}
				{node.offers.length > 0 && (
					<ul className="timeline-offers">
						{node.offers.map((o, i) => (
							<li key={i}>
								<p>
									{name(o.from)} offered this version to{" "}
									{name(o.to)}, unchanged ·{" "}
									<span
										className={
											o.status === "committed"
												? "good"
												: ""
										}
									>
										{offerAnswer(o)}
									</span>
								</p>
								<Reasoning
									heading={`Why ${name(o.from)} offered it`}
									text={o.why}
									show={showPrivate}
								/>
								<Reasoning
									heading={`Why ${name(o.to)} answered`}
									text={o.answerWhy}
									show={showPrivate}
								/>
							</li>
						))}
					</ul>
				)}
			</div>
		</li>
	);
}

// How a team's idea evolved, for the Teams tab: a header naming the version the team builds, a step bar of
// every version that scrolls sideways when there are many, and a rail with one node per version in the order
// they were sent. Updates as the replay plays.
export function IdeaTimeline({
	timeline,
	owner,
	founder,
	status,
	anchorPrefix,
	filledBy,
	showPrivate,
}: {
	timeline: Timeline;
	owner: string;
	founder: string;
	status: string;
	// Makes each node's anchor unique on the page, e.g. the team's id.
	anchorPrefix: string;
	filledBy: Record<string, string> | undefined;
	showPrivate: boolean;
}) {
	const { nodes, chosen, latest, laterNotAdopted } = timeline;
	const bar = useRef<HTMLOListElement>(null);
	const seen = useRef(0);
	const anchor = (n: number) => `${anchorPrefix}-v${n}`;
	// On first show, bring the chosen step into view; as the replay adds versions, follow the newest.
	useEffect(() => {
		const el = bar.current;
		if (!el) return;
		const target =
			seen.current === 0 && chosen !== undefined ? chosen : latest;
		if (seen.current !== nodes.length) {
			const step = el.children[target] as HTMLElement | undefined;
			if (step)
				el.scrollLeft =
					step.offsetLeft - el.clientWidth / 2 + step.clientWidth / 2;
			seen.current = nodes.length;
		}
	}, [nodes.length, chosen, latest]);
	const shown = chosen ?? latest;
	return (
		<div className="idea-timeline">
			<div className="timeline-header">
				<div className="timeline-title-row">
					<h4>{timeline.title ?? "Untitled project"}</h4>
					<span className="timeline-status">{status}</span>
				</div>
				<p className="timeline-meta">
					In {name(owner)}’s conversation with {name(founder)} ·{" "}
					{nodes.length} {nodes.length === 1 ? "version" : "versions"}
					{laterNotAdopted > 0 &&
						` · builds v${shown + 1}; ${laterNotAdopted} later ${
							laterNotAdopted === 1
								? "version was"
								: "versions were"
						} not adopted`}
				</p>
				<ol className="timeline-steps" ref={bar} aria-label="Versions">
					{nodes.map((node) => (
						<li
							key={node.n}
							className={`timeline-step ${node.state}`}
						>
							<button
								type="button"
								onClick={() =>
									document
										.getElementById(anchor(node.n))
										?.scrollIntoView({
											behavior: "smooth",
											block: "nearest",
										})
								}
							>
								<span className="step-dot" />
								<span className="step-label">{node.label}</span>
								<span className="step-sub">
									v{node.n} · {shortId(node.v.from)}{" "}
									{stepVerb(node.v)}
								</span>
								{node.state === "chosen" && (
									<span className="step-chosen">Chosen</span>
								)}
							</button>
						</li>
					))}
				</ol>
			</div>
			<ol className="timeline-rail">
				{nodes.map((node) => (
					<Node
						key={node.n}
						node={node}
						timeline={timeline}
						anchor={anchor(node.n)}
						filledBy={
							node.state === "chosen" ? filledBy : undefined
						}
						showPrivate={showPrivate}
					/>
				))}
			</ol>
		</div>
	);
}
