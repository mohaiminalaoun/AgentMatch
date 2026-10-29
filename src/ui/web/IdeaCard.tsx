import React from "react";
import type { IdeaVersion } from "./replay.js";

const name = (id: string) =>
	`Agent ${id.replace(/^a0?/, "").replace(/^p/, "").padStart(2, "0")}`;
const did: Record<IdeaVersion["how"], string> = {
	proposal: "proposed it",
	join: "asked to join it",
	counter: "countered with a new version",
	revision: "reshaped it",
	offer: "offered it as the team’s project",
};
// What the other side did with a version, as a sentence.
function outcome(v: IdeaVersion): string {
	const to = name(v.to);
	switch (v.status) {
		case "open":
			return `Waiting for ${to}`;
		case "accepted":
			return `${to} accepted`;
		case "declined":
			return `${to} declined`;
		case "countered":
			return `${to} countered`;
		case "adopted":
			return `${to} adopted it`;
		case "kept":
			return `${to} kept the earlier version`;
		case "committed":
			return `${to} joined the team`;
		case "busy":
			return `${to} was busy with offers of their own`;
	}
}
const good = new Set(["accepted", "adopted", "committed"]);

// A version's pitch and its full roles; roles added since `before` are marked, and dropped ones struck.
function Version({
	v,
	before,
}: {
	v: IdeaVersion;
	before?: IdeaVersion | undefined;
}) {
	const dropped = before
		? before.rolesNeeded.filter((r) => !v.rolesNeeded.includes(r))
		: [];
	return (
		<>
			{before && before.pitch === v.pitch ? (
				<p className="idea-same">Same pitch as before</p>
			) : (
				<p className="idea-pitch">“{v.pitch}”</p>
			)}
			<div className="idea-roles">
				{v.rolesNeeded.map((r) => (
					<span
						key={r}
						className={
							before && !before.rolesNeeded.includes(r)
								? "added"
								: ""
						}
					>
						{before && !before.rolesNeeded.includes(r) ? "+" : ""}
						{r}
					</span>
				))}
				{dropped.map((r) => (
					<span key={r} className="dropped">
						−{r}
					</span>
				))}
			</div>
		</>
	);
}

// The project idea two agents are discussing, read top to bottom: how it started, each change and what
// the other side did with it, and how it stands now. Updates as the replay plays.
export function IdeaCard({
	versions,
	agreed,
}: {
	versions: IdeaVersion[];
	agreed: number | undefined;
}) {
	const first = versions[0];
	if (!first) return null;
	const end = agreed ?? versions.length - 1;
	const last = versions[end]!;
	const label =
		agreed === undefined
			? "STILL ON THE TABLE"
			: last.status === "committed"
				? "ENDS AS THE TEAM’S PROJECT"
				: "AGREED NOW";
	return (
		<div className="idea-card">
			<div className="detail-label">STARTED AS</div>
			<Version v={first} />
			<p className="idea-meta">
				{name(first.author)}’s idea
				{first.how === "join" &&
					` · ${name(first.from)} ${did.join}`} ·{" "}
				<span className={good.has(first.status) ? "good" : ""}>
					{outcome(first)}
				</span>
			</p>
			{versions.length > 1 && (
				<ol className="idea-history">
					{versions.slice(1).map((v, i) => (
						<li key={i}>
							<div className="idea-step">
								v{i + 2} · {name(v.from)} {did[v.how]}
							</div>
							<Version v={v} before={versions[i]} />
							<p className="idea-meta">
								<span
									className={good.has(v.status) ? "good" : ""}
								>
									{outcome(v)}
								</span>
							</p>
						</li>
					))}
				</ol>
			)}
			<div className="idea-end">
				<div className="detail-label">
					{label} <span>v{end + 1}</span>
				</div>
				{versions.length === 1 ? (
					<p className="idea-same">Unchanged since it was proposed</p>
				) : (
					<Version v={last} />
				)}
				<p className="idea-meta">{name(last.author)}’s idea</p>
			</div>
		</div>
	);
}
