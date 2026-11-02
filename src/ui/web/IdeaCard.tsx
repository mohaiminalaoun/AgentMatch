import React, { useLayoutEffect, useRef, useState } from "react";
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
import {
	needsGap,
	roleName,
	type PitchChange as Change,
	type RoleChange,
} from "./timeline.js";

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
	heading = "ROLES THEY’RE LOOKING FOR",
	filledBy,
}: {
	roles: readonly string[];
	card: Card;
	before?: IdeaVersion | undefined;
	heading?: string;
	// Who on the team fills each role, as role to agent id, when it's known.
	filledBy?: Record<string, string> | undefined;
}) {
	const [open, setOpen] = useState(true);
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
				{filledBy && cls !== "dropped" && (
					<span
						className={`role-filled${filledBy[role] ? "" : " open"}`}
					>
						{filledBy[role] ? name(filledBy[role]) : "No one yet"}
					</span>
				)}
			</div>
		);
	};
	return (
		<>
			<button
				type="button"
				className="detail-label roles-label roles-toggle"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
			>
				<Users size={13} /> {heading} <span>{roles.length}</span>
				<ChevronDown
					size={13}
					className={open ? "roles-chevron open" : "roles-chevron"}
				/>
			</button>
			{!open && (
				<p className="roles-summary">
					{roles.map(titleCase).join(" · ")}
				</p>
			)}
			{open && (
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
			)}
		</>
	);
}

// A version's pitch and its full roles; roles added since `before` are marked, and dropped ones struck.
function Version({
	v,
	before,
	roleHeading,
	filledBy,
}: {
	v: IdeaVersion;
	before?: IdeaVersion | undefined;
	roleHeading?: string;
	filledBy?: Record<string, string> | undefined;
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
			<RoleCards
				roles={v.rolesNeeded}
				card={v.card}
				before={before}
				{...(roleHeading && { heading: roleHeading })}
				filledBy={filledBy}
			/>
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
// A counter's reasoning is the reason for the version it sends, so it shows there, not here too.
function Why({ v, show }: { v: IdeaVersion; show: boolean }) {
	const answerWhy = v.status === "countered" ? undefined : v.answerWhy;
	if (!show || (!v.why && !answerWhy)) return null;
	return (
		<details className="idea-why">
			<summary>Private reasoning</summary>
			{v.why && (
				<p>
					<strong>{name(v.from)}:</strong> {v.why}
				</p>
			)}
			{answerWhy && (
				<p>
					<strong>{name(v.to)}:</strong> {answerWhy}
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

// What the other side did with a version, as a footer under it: a rule separates it from the description above,
// and a coloured chip says how it went. `by` names whose idea it is, on the left, when worth saying.
export function Outcome({
	v,
	by,
}: {
	v: IdeaVersion;
	by?: string | undefined;
}) {
	const tone = good.has(v.status)
		? "good"
		: v.status === "countered" || v.status === "kept"
			? "warn"
			: v.status === "declined"
				? "bad"
				: "wait";
	return (
		<div className="version-outcome">
			{by && <span className="version-by">{by}</span>}
			<span className={`outcome-chip ${tone}`}>{outcome(v)}</span>
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
	filledBy,
}: {
	versions: IdeaVersion[];
	agreed: number | undefined;
	showWhy?: boolean;
	// Who on the team fills each role of the final version, as role to agent id, once the team has formed.
	filledBy?: Record<string, string> | undefined;
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
				<span className="version-badge">v1</span>
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
					<Version
						v={first}
						// With one version, it's also how the idea ends, so this is where who fills each role goes.
						{...(versions.length === 1 &&
							filledBy && {
								roleHeading: "WHO FILLS EACH ROLE",
								filledBy,
							})}
					/>
					<Outcome
						v={first}
						by={`${name(first.author)}’s idea${first.how === "join" ? ` · ${name(first.from)} ${did.join}` : ""}`}
					/>
					<Why v={first} show={showWhy} />
					<Offers v={first} show={showWhy} />
					{versions.length > 1 && (
						<ol className="idea-history">
							{versions.slice(1).map((v, i) => (
								<li key={i}>
									<div className="version-head">
										<span className="version-badge">
											v{i + 2}
										</span>
										{name(v.from)} {did[v.how]}
									</div>
									<Version v={v} before={versions[i]} />
									<Outcome v={v} />
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
							<Version
								v={last}
								roleHeading={
									filledBy
										? "WHO FILLS EACH ROLE"
										: "ROLES THIS PROJECT NEEDS"
								}
								filledBy={filledBy}
							/>
						)}
						<p className="idea-meta">{name(last.author)}’s idea</p>
					</div>
				</>
			)}
		</div>
	);
}

// How a pitch changed from the version before: small edits as a word diff (added words marked, removed ones
// struck), and a substantial rewrite as the two pitches, before and after.
export function PitchChange({
	pitch,
	change,
}: {
	pitch: string;
	change: Change;
}) {
	if (change.mode === "rewrite")
		return (
			<div className="pitch-rewrite">
				<div>
					<span>Before</span>
					<p>“{change.before}”</p>
				</div>
				<div>
					<span>After</span>
					<p>“{change.after}”</p>
				</div>
			</div>
		);
	if (change.mode === "inline")
		return (
			<p className="idea-pitch pitch-diff">
				“
				{change.diff.map((d, i) => {
					const gap = needsGap(d, change.diff[i + 1]) ? " " : "";
					return d.op === "added" ? (
						<React.Fragment key={i}>
							<ins>{d.text}</ins>
							{gap}
						</React.Fragment>
					) : d.op === "removed" ? (
						<React.Fragment key={i}>
							<del>{d.text}</del>
							{gap}
						</React.Fragment>
					) : (
						<span key={i}>{d.text}</span>
					);
				})}
				”
			</p>
		);
	return <p className="idea-pitch">“{pitch}”</p>;
}

// The roles a version needs as small chips, with roles added since the version before marked + and dropped
// ones struck −.
export function RoleChips({ roles }: { roles: RoleChange[] }) {
	if (roles.length === 0) return null;
	return (
		<ul className="role-chips">
			{roles.map((r) => (
				<li
					key={`${r.change}-${r.role}`}
					className={`role-chip ${r.change}`}
				>
					{r.change === "added" && "+ "}
					{r.change === "dropped" && "− "}
					{roleName(r.role)}
				</li>
			))}
		</ul>
	);
}

// An agent's private reasoning, verbatim, under a heading saying whose it is and what it was for. Shown only
// in the operator's private view. It starts clamped to a few lines; only when that actually cuts the text off
// (measured, and re-measured as the panel resizes) is there a button to show all of it.
export function Reasoning({
	heading,
	text,
	show,
}: {
	heading: string;
	text: string | undefined;
	show: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [cut, setCut] = useState(false);
	const body = useRef<HTMLParagraphElement>(null);
	useLayoutEffect(() => {
		const el = body.current;
		if (!el || open) return;
		const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
		measure();
		const watch = new ResizeObserver(measure);
		watch.observe(el);
		return () => watch.disconnect();
	}, [open, text, show]);
	if (!show || !text) return null;
	return (
		<div className="reason-box">
			<div className="reason-head">
				<span>{heading}</span>
				<span className="reason-private">Private reasoning</span>
			</div>
			<p ref={body} className={open ? "" : "clamped"}>
				{text}
			</p>
			{(cut || open) && (
				<button
					type="button"
					className="link-button reason-more"
					aria-expanded={open}
					onClick={() => setOpen((o) => !o)}
				>
					{open ? "Show less" : "Show full reasoning"}
				</button>
			)}
		</div>
	);
}
