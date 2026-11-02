import React, { useState } from "react";
import {
	Brain,
	ClipboardList,
	ChevronDown,
	ChevronUp,
	Cloud,
	CodeXml,
	Database,
	PencilLine,
	Server,
	Smartphone,
	Users,
} from "lucide-react";
import type { Card, IdeaVersion, OfferStep } from "./replay.js";

// "a03" → "Agent 03", "p4" → "Agent 04", and a pilot id like "p-c41e" → "Agent c41e".
export const agentLabel = (id: string) =>
	`Agent ${id.replace(/^a0?/, "").replace(/^p-?/, "").padStart(2, "0")}`;
const name = agentLabel;
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

// An icon for each role a project can need.
const roleIcons: Record<string, typeof CodeXml> = {
	frontend: CodeXml,
	backend: Server,
	mobile: Smartphone,
	ml: Brain,
	data: Database,
	design: PencilLine,
	devops: Cloud,
	product: ClipboardList,
};
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A card for each role a project needs, with what that role would do when the card says. Given `before`,
// roles added since are marked, and dropped ones struck.
export function RoleCards({
	roles,
	card,
	before,
}: {
	roles: readonly string[];
	card: Card;
	before?: IdeaVersion | undefined;
}) {
	const dropped = before
		? before.rolesNeeded.filter((r) => !roles.includes(r))
		: [];
	const cardFor = (role: string, cls: string, work: string | undefined) => {
		const Icon = roleIcons[role] ?? Users;
		return (
			<div className={`role-card ${cls}`} key={`${cls}-${role}`}>
				<span className="role-icon">
					<Icon size={15} />
				</span>
				<div>
					<strong>
						{cls === "added" && "+"}
						{cls === "dropped" && "−"}
						{titleCase(role)}
					</strong>
					{work && <p>{work}</p>}
				</div>
			</div>
		);
	};
	return (
		<>
			<div className="detail-label roles-label">
				<Users size={13} /> ROLES THEY’RE LOOKING FOR{" "}
				<span>{roles.length}</span>
			</div>
			<div className="role-cards">
				{roles.map((r) =>
					cardFor(
						r,
						before && !before.rolesNeeded.includes(r)
							? "added"
							: "",
						card.roleWork?.[r],
					),
				)}
				{dropped.map((r) => cardFor(r, "dropped", undefined))}
			</div>
		</>
	);
}

// A version's pitch and its full roles; roles added since `before` are marked, and dropped ones struck.
function Version({
	v,
	before,
}: {
	v: IdeaVersion;
	before?: IdeaVersion | undefined;
}) {
	const renamed = v.title && v.title !== before?.title;
	return (
		<>
			{renamed && <p className="idea-title">{v.title}</p>}
			{before && before.pitch === v.pitch ? (
				<p className="idea-same">Same pitch as before</p>
			) : (
				<p className="idea-pitch">“{v.pitch}”</p>
			)}
			<CardDetails card={v.card} roles={[]} before={before?.card} />
			<RoleCards roles={v.rolesNeeded} card={v.card} before={before} />
		</>
	);
}

// A version's project card: the problem, the weekend build, and what each needed role would build. Given
// `before`, only what changed from it is shown. Shows nothing when there's no card, as in older logs.
export function CardDetails({
	card,
	roles,
	before,
	compact = false,
}: {
	card: Card;
	roles: readonly string[];
	before?: Card | undefined;
	compact?: boolean;
}) {
	const problem =
		card.problem && card.problem !== before?.problem
			? card.problem
			: undefined;
	const build =
		card.build && card.build !== before?.build ? card.build : undefined;
	const work = roles.flatMap((role) => {
		const text = card.roleWork?.[role];
		return text && text !== before?.roleWork?.[role] ? [[role, text]] : [];
	});
	if (!problem && !build && work.length === 0) return null;
	return (
		<dl className={`card-details${compact ? " compact" : ""}`}>
			{problem && (
				<div>
					<dt>Problem</dt>
					<dd>{problem}</dd>
				</div>
			)}
			{build && (
				<div>
					<dt>Weekend build</dt>
					<dd>{build}</dd>
				</div>
			)}
			{work.map(([role, text]) => (
				<div key={role}>
					<dt className="card-role">{role}</dt>
					<dd>{text}</dd>
				</div>
			))}
		</dl>
	);
}

// Offers that carried a version unchanged as a team's project, one line each with its answer, and the private
// reasoning behind both when `show` is set.
function Offers({ v, show }: { v: IdeaVersion; show: boolean }) {
	if (!v.offers?.length) return null;
	const answer = (o: OfferStep) =>
		o.status === "committed"
			? `${name(o.to)} joined the team`
			: o.status === "busy"
				? `${name(o.to)} was busy with offers of their own`
				: o.status === "declined"
					? `${name(o.to)} declined`
					: `Waiting for ${name(o.to)}`;
	return (
		<ul className="idea-offers">
			{v.offers.map((o, i) => (
				<li key={i}>
					<p className="idea-meta">
						{name(o.from)} offered it as the team’s project,
						unchanged ·{" "}
						<span
							className={o.status === "committed" ? "good" : ""}
						>
							{answer(o)}
						</span>
					</p>
					{show && (o.why || o.answerWhy) && (
						<details className="idea-why">
							<summary>Private reasoning</summary>
							{o.why && (
								<p>
									<strong>{name(o.from)}:</strong> {o.why}
								</p>
							)}
							{o.answerWhy && (
								<p>
									<strong>{name(o.to)}:</strong> {o.answerWhy}
								</p>
							)}
						</details>
					)}
				</li>
			))}
		</ul>
	);
}

// The private reasoning behind a version and behind the answer to it, folded away until opened.
function Why({ v, show }: { v: IdeaVersion; show: boolean }) {
	if (!show || (!v.why && !v.answerWhy)) return null;
	return (
		<details className="idea-why">
			<summary>Private reasoning</summary>
			{v.why && (
				<p>
					<strong>{name(v.from)}:</strong> {v.why}
				</p>
			)}
			{v.answerWhy && (
				<p>
					<strong>{name(v.to)}:</strong> {v.answerWhy}
				</p>
			)}
		</details>
	);
}

// A version folded to its name and one line about it, for the collapsed idea card.
function Summary({
	title,
	pitch,
}: {
	title: string | undefined;
	pitch: string;
}) {
	return (
		<div className="idea-summary">
			{title && <p className="idea-title">{title}</p>}
			<p className="idea-pitch">“{pitch}”</p>
		</div>
	);
}

// The project idea two agents are discussing, read top to bottom: how it started, each change and what
// the other side did with it, and how it stands now. Updates as the replay plays.
// With `showWhy`, each version can be opened to show the private reasoning behind it.
export function IdeaCard({
	versions,
	agreed,
	showWhy = false,
}: {
	versions: IdeaVersion[];
	agreed: number | undefined;
	showWhy?: boolean;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const first = versions[0];
	if (!first) return null;
	const end = agreed ?? versions.length - 1;
	const last = versions[end]!;
	// A version only carries its title when it renamed the project, so look back for the latest one.
	const titleAt = (i: number) =>
		versions
			.slice(0, i + 1)
			.reverse()
			.find((v) => v.title)?.title;
	const joined =
		last.status === "committed" ||
		(last.offers ?? []).some((o) => o.status === "committed");
	const label =
		agreed === undefined
			? "STILL ON THE TABLE"
			: joined
				? "ENDS AS THE TEAM’S PROJECT"
				: "AGREED NOW";
	return (
		<div className="idea-card idea-block">
			<div className="detail-label">
				STARTED AS
				<button
					type="button"
					className="idea-collapse"
					aria-expanded={!collapsed}
					onClick={() => setCollapsed((c) => !c)}
				>
					{collapsed ? "Expand" : "Collapse"}
					{collapsed ? (
						<ChevronDown size={12} />
					) : (
						<ChevronUp size={12} />
					)}
				</button>
			</div>
			{collapsed && (
				<>
					<Summary title={titleAt(0)} pitch={first.pitch} />
					<div className="detail-label idea-end-label">
						{label} <span>v{end + 1}</span>
					</div>
					<Summary title={titleAt(end)} pitch={last.pitch} />
				</>
			)}
			{!collapsed && (
				<>
					<Version v={first} />
					<p className="idea-meta">
						{name(first.author)}’s idea
						{first.how === "join" &&
							` · ${name(first.from)} ${did.join}`}{" "}
						·{" "}
						<span className={good.has(first.status) ? "good" : ""}>
							{outcome(first)}
						</span>
					</p>
					<Why v={first} show={showWhy} />
					<Offers v={first} show={showWhy} />
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
											className={
												good.has(v.status) ? "good" : ""
											}
										>
											{outcome(v)}
										</span>
									</p>
									<Why v={v} show={showWhy} />
									<Offers v={v} show={showWhy} />
								</li>
							))}
						</ol>
					)}
					<div className="idea-end">
						<div className="detail-label">
							{label} <span>v{end + 1}</span>
						</div>
						{versions.length === 1 ? (
							<p className="idea-same">
								Unchanged since it was proposed
							</p>
						) : (
							<Version v={last} />
						)}
						<p className="idea-meta">{name(last.author)}’s idea</p>
					</div>
				</>
			)}
		</div>
	);
}
