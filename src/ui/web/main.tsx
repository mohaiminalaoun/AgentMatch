import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
	ArrowRight,
	Check,
	ChevronDown,
	ChevronRight,
	CircleHelp,
	Eye,
	Fingerprint,
	FlaskConical,
	GitBranch,
	Globe2,
	Layers3,
	LockKeyhole,
	Maximize2,
	Network,
	Pause,
	Play,
	RotateCcw,
	Search,
	Settings2,
	ShieldCheck,
	SkipBack,
	SkipForward,
	Sparkles,
	Upload,
	Users,
	X,
} from "lucide-react";
import {
	demoEvents,
	describe,
	parseLog,
	project,
	type Event,
} from "./replay.js";
import "./style.css";
import { groupAgents } from "./layout.js";
import { AgentCharacter, type Mood } from "./AgentCharacter.js";
const colors = ["#9079e5", "#59a7a0", "#c49b57", "#d48497", "#7e9cbf"];
const short = (id: string) => id.replace(/^a0?/, "").replace(/^p/, "");
function App() {
	const [events, setEvents] = useState<Event[]>(demoEvents),
		[cursor, setCursor] = useState(51),
		[playing, setPlaying] = useState(false),
		[speed, setSpeed] = useState(1),
		[selected, setSelected] = useState("a01"),
		[tab, setTab] = useState("Overview"),
		[view, setView] = useState("network"),
		[source, setSource] = useState("The first connections"),
		[error, setError] = useState(""),
		[privateView, setPrivate] = useState(false),
		[query, setQuery] = useState(""),
		[approvals, setApprovals] = useState<Record<string, string>>({}),
		[showHelp, setHelp] = useState(false),
		[showMessages, setShowMessages] = useState(false);
	const file = useRef<HTMLInputElement>(null);
	const canvas = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!playing) return;
		const t = setInterval(
			() =>
				setCursor((c) => {
					if (c >= events.length) {
						setPlaying(false);
						return c;
					}
					return c + 1;
				}),
			650 / speed,
		);
		return () => clearInterval(t);
	}, [playing, speed, events.length]);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
			)
				return;
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			e.preventDefault();
			setPlaying(false);
			setCursor((c) =>
				e.key === "ArrowLeft"
					? Math.max(c - 1, 0)
					: Math.min(c + 1, events.length),
			);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [events.length]);
	const state = useMemo(
		() => project(events.slice(0, cursor)),
		[events, cursor],
	);
	const people = state.people;
	const current = people.find((p) => p.id === selected) ?? people[0];
	const visibleEvents = events
		.slice(0, cursor)
		.filter((e) => e.type !== "exchange");
	const feedRows = events
		.slice(0, cursor)
		.map((e, i) => ({ e, n: i + 1 }))
		.filter(
			({ e }) =>
				e.type !== "exchange" && (showMessages || e.type !== "bus"),
		)
		.reverse();
	const related = current
		? visibleEvents.filter(
				(e) =>
					("agent" in e && e.agent === current.id) ||
					("other" in e && e.other === current.id) ||
					(e.type === "bus" &&
						e.event.type === "sent" &&
						(e.event.message.from === current.id ||
							e.event.message.to === current.id)),
			)
		: [];
	const teamFor = (id: string) =>
		state.teams.find((t) => t.members.includes(id));
	const {
		placements,
		circles,
		height: canvasHeight,
	} = useMemo(
		() =>
			groupAgents(
				people.map((p) => p.id),
				state.teams,
				current?.id ?? "",
			),
		[people, state.teams, current?.id],
	);
	const points = people.map((p) => placements[p.id]!);
	const point = (id: string) => placements[id];
	const palette = [
		"#28bbae",
		"#ffbc45",
		"#8e77f7",
		"#ff7769",
		"#65a9e7",
		"#e38fb4",
	];
	const characterColor = (id: string) =>
		palette[
			Math.max(
				0,
				people.findIndex((p) => p.id === id),
			) % palette.length
		]!;
	const disclosure = (id: string) =>
		Math.max(
			0,
			...state.links
				.filter((l) => l.a === id || l.b === id)
				.map((l) => l.level),
			teamFor(id) ? 3 : 0,
		);
	const moodFor = (id: string): Mood => {
		if (teamFor(id)) return "matched";
		const last = visibleEvents
			.filter((e) => "agent" in e && e.agent === id)
			.at(-1);
		if (last?.type === "decision" && last.decision.decision === "decline")
			return "declining";
		if (
			last?.type === "discovery" ||
			last?.type === "listing" ||
			(last?.type === "decision" && last.decision.decision === "counter")
		)
			return "pitching";
		return "idle";
	};
	const speechFor = (id: string) =>
		({
			matched: "Found my people!",
			declining: "Not my fit, thank you.",
			pitching: "I have an idea…",
			idle: "Let’s get to know each other.",
		})[moodFor(id)];

	async function load(f: File) {
		try {
			const next = parseLog(await f.text());
			project(next);
			setEvents(next);
			setCursor(Math.min(next.length, 20));
			setSource(f.name.replace(".jsonl", ""));
			setPlaying(false);
			setApprovals({});
			setError("");
			setSelected("");
		} catch (e) {
			setError(
				e instanceof Error ? e.message : "Unable to read this log.",
			);
		}
	}
	return (
		<div className="app-shell">
			<aside className="rail">
				<a className="brand-mark" href="#" aria-label="AgentMatch home">
					<Network size={25} />
				</a>
				<button
					className={
						view === "network"
							? "rail-button active"
							: "rail-button"
					}
					title="Network"
					onClick={() => setView("network")}
				>
					<Network size={21} />
				</button>
				<button
					className={
						view === "teams" ? "rail-button active" : "rail-button"
					}
					title="Teams"
					onClick={() => setView("teams")}
				>
					<Users size={21} />
					{state.teams.length > 0 && <i />}
				</button>
				<button
					className="rail-button"
					title="Import a run"
					onClick={() => file.current?.click()}
				>
					<Layers3 size={21} />
				</button>
				<div className="rail-bottom">
					<button
						className="rail-button"
						title="Replay guide"
						onClick={() => setHelp(true)}
					>
						<CircleHelp size={21} />
					</button>
					<span className="user-avatar">M</span>
				</div>
			</aside>
			<main>
				<header className="topbar">
					<div className="wordmark">
						agent<span>match</span>
						<span className="beta">LAB</span>
					</div>
					<div className="breadcrumb">
						Workspace <ChevronRight size={13} />{" "}
						<span>Simulation studio</span>
					</div>
					<div className="top-right">
						<span className="local-badge">
							<span />
							Local session
						</span>
						<button
							className="icon-button"
							aria-label="Replay settings"
							onClick={() => setHelp(true)}
						>
							<Settings2 size={18} />
						</button>
					</div>
				</header>
				<div className="workspace">
					<section className="page-title">
						<div>
							<div className="eyebrow">
								<span /> A LITTLE INDEPENDENCE. A LOT OF
								POSSIBILITY.
							</div>
							<h1>
								The meeting of minds<span>.</span>
							</h1>
							<p>
								Watch independent agents find their people. One
								conversation at a time.
							</p>
						</div>
						<button
							className="button import-button"
							onClick={() => file.current?.click()}
						>
							<Upload size={15} /> Import run <span>JSONL</span>
						</button>
						<input
							ref={file}
							type="file"
							accept=".jsonl,.json"
							hidden
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) void load(f);
								e.target.value = "";
							}}
						/>
					</section>
					{error && (
						<div className="error" role="alert">
							{error}
							<button
								onClick={() => setError("")}
								aria-label="Dismiss error"
							>
								<X size={16} />
							</button>
						</div>
					)}
					<section className="meet-agent">
						<div className="meet-intro">
							<span className="eyebrow">
								A SMALL AGENT. YOUR BIG IDEAS.
							</span>
							<h2>
								Meet your agent<span> ✳</span>
							</h2>
							<p>
								A little personality.
								<br />A lot of possibility.
							</p>
							<span className="mascot-note">
								Three lights. Three stages of trust.
							</span>
						</div>
						<div className="your-character">
							<AgentCharacter
								color={
									current
										? characterColor(current.id)
										: "#28bbae"
								}
								level={current ? disclosure(current.id) : 0}
								mood={current ? moodFor(current.id) : "idle"}
								sprout
								badge="M"
								width={158}
								height={198}
							/>
							<strong>
								{current
									? `Agent ${short(current.id).padStart(2, "0")}`
									: "Your agent"}
							</strong>
							<span>
								{current
									? `${disclosure(current.id)} of 3 disclosure stages unlocked`
									: "Ready when you are"}
							</span>
						</div>
						<div className="character-examples">
							<div className="character-example">
								<div className="speech-bubble">
									I have a<br />
									web app idea!
								</div>
								<AgentCharacter
									color="#ffbc45"
									mood="pitching"
									width={88}
									height={110}
								/>
								<span>Making the first move</span>
							</div>
							<div className="character-example">
								<div className="speech-bubble">
									Not my fit,
									<br />
									thank you!
								</div>
								<AgentCharacter
									color="#8e77f7"
									mood="declining"
									width={88}
									height={110}
								/>
								<span>Declining, sharing nothing</span>
							</div>
							<div className="character-example">
								<div className="speech-bubble">
									Want to
									<br />
									team up?
								</div>
								<AgentCharacter
									color="#ff7769"
									mood="matched"
									level={3}
									width={88}
									height={110}
								/>
								<span>Finding their people</span>
							</div>
						</div>
					</section>
					<section className="run-strip">
						<div className="run-icon">
							<FlaskConical size={21} />
						</div>
						<div className="run-info">
							<strong>{source}</strong>
							<span>
								{events === demoEvents
									? "SYNTHETIC DEMO"
									: "IMPORTED REPLAY"}{" "}
								<b>·</b> {people.length} independent agents{" "}
								<b>·</b> No live model calls
							</span>
						</div>
						<div className="run-stat">
							<strong>
								{state.tick.toString().padStart(2, "0")}
							</strong>
							<span>Current tick</span>
						</div>
						<div className="run-stat">
							<strong>
								{state.teams.length.toString().padStart(2, "0")}
							</strong>
							<span>Teams formed</span>
						</div>
						<div className="run-stat protection">
							<ShieldCheck size={19} />
							<div>
								<strong>{state.gates} gate blocks</strong>
								<span>Disclosure checks active</span>
							</div>
						</div>
					</section>
					<div className="studio-grid">
						<section className="network-panel">
							<div className="panel-toolbar">
								<div className="view-tabs">
									<button
										className={
											view === "network" ? "selected" : ""
										}
										onClick={() => setView("network")}
									>
										<Network size={15} /> Agent network
									</button>
									<button
										className={
											view === "teams" ? "selected" : ""
										}
										onClick={() => setView("teams")}
									>
										<Users size={15} /> Teams{" "}
										<span>{state.teams.length}</span>
									</button>
								</div>
								<div className="toolbar-right">
									<span className="replay-badge">
										<span />
										{playing ? "PLAYING" : "REPLAY"}
									</span>
									<button
										className="icon-button"
										title="Expand canvas"
										onClick={() => {
											if (document.fullscreenElement)
												void document.exitFullscreen();
											else
												void canvas.current?.requestFullscreen();
										}}
									>
										<Maximize2 size={15} />
									</button>
								</div>
							</div>
							<div ref={canvas} className="network-canvas">
								{view === "network" ? (
									<>
										<div className="canvas-caption">
											<span className="live-dot" /> THE
											POSSIBILITY SPACE
											<span>
												Every dot is someone’s next
												chapter.
											</span>
										</div>
										<svg
											viewBox={`0 0 860 ${canvasHeight}`}
											style={{
												aspectRatio: `860 / ${canvasHeight}`,
												maxHeight: "none",
											}}
											role="img"
											aria-label="Agent connections and team clusters"
										>
											<defs>
												<radialGradient id="halo">
													<stop
														stopColor="#e6e0fa"
														stopOpacity=".6"
													/>
													<stop
														offset="1"
														stopColor="#f7f8fa"
														stopOpacity="0"
													/>
												</radialGradient>
											</defs>
											{circles
												.filter((c) =>
													c.id.startsWith("open-"),
												)
												.map((c) => (
													<text
														key={c.id}
														x={c.x}
														y={c.titleY}
														textAnchor="middle"
														className="team-label open-group-label"
													>
														Still exploring
													</text>
												))}
											{state.teams.map((t, i) => (
												<g key={t.id}>
													<ellipse
														className="team-halo"
														cx={circles[i]!.x}
														cy={circles[i]!.y}
														rx={circles[i]!.radius}
														ry={circles[i]!.radius}
														fill={
															colors[
																i %
																	colors.length
															]
														}
														fillOpacity=".065"
														stroke={
															colors[
																i %
																	colors.length
															]
														}
														strokeOpacity=".18"
														strokeDasharray="4 5"
													/>
													<text
														x={circles[i]!.x}
														y={circles[i]!.titleY}
														textAnchor="middle"
														className="team-label"
													>
														{t.project.title}
													</text>
												</g>
											))}
											{state.links.map((l) => {
												const a = point(l.a),
													b = point(l.b);
												return a && b ? (
													<g
														key={[l.a, l.b]
															.sort()
															.join(":")}
													>
														<line
															x1={a.x}
															y1={a.y}
															x2={b.x}
															y2={b.y}
															stroke={
																l.level >= 2
																	? "#9c89ce"
																	: "#c9c9d9"
															}
															strokeWidth={
																l.a ===
																	current?.id ||
																l.b ===
																	current?.id
																	? 2
																	: 1.2
															}
															strokeDasharray={
																l.level === 0
																	? "4 5"
																	: undefined
															}
														/>
														<circle
															r="3"
															fill="#a18bdb"
														>
															<animateMotion
																dur="4s"
																repeatCount="indefinite"
																path={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
															/>
														</circle>
													</g>
												) : null;
											})}
											{people.map((p, i) => {
												const pos = points[i]!;
												const active =
													p.id === current?.id;
												const dim =
													query &&
													!`${p.id} ${p.pitch} ${p.roles.join(" ")}`
														.toLowerCase()
														.includes(
															query.toLowerCase(),
														);
												return (
													<g
														key={p.id}
														className={`agent-node ${active ? "is-selected" : ""}`}
														style={{
															opacity: dim
																? 0.2
																: 1,
															transform: `translate(${pos.x}px,${pos.y}px)`,
														}}
														role="button"
														tabIndex={0}
														aria-label={`Inspect agent ${p.id}`}
														onClick={() => {
															setSelected(p.id);
															setTab("Overview");
														}}
														onKeyDown={(e) => {
															if (
																e.key ===
																	"Enter" ||
																e.key === " "
															)
																setSelected(
																	p.id,
																);
														}}
													>
														<g
															transform={`scale(${pos.scale})`}
														>
															{active && (
																<ellipse
																	cx="0"
																	cy="8"
																	rx="46"
																	ry="49"
																	fill={characterColor(
																		p.id,
																	)}
																	fillOpacity=".08"
																	stroke={characterColor(
																		p.id,
																	)}
																	strokeOpacity=".3"
																	strokeDasharray="3 5"
																/>
															)}
															<AgentCharacter
																color={characterColor(
																	p.id,
																)}
																level={disclosure(
																	p.id,
																)}
																mood={moodFor(
																	p.id,
																)}
																sprout={i === 0}
																width={
																	active
																		? 94
																		: 76
																}
																height={
																	active
																		? 117
																		: 95
																}
																x={
																	active
																		? -47
																		: -38
																}
																y={
																	active
																		? -62
																		: -50
																}
															/>
															{active && (
																<g className="network-speech">
																	<rect
																		x="-74"
																		y="-94"
																		width="148"
																		height="27"
																		rx="12"
																		fill="white"
																		stroke="#e7e1ef"
																	/>
																	<path
																		d="M-6 -67 L0 -60 L6 -67"
																		fill="white"
																	/>
																	<text
																		x="0"
																		y="-77"
																		textAnchor="middle"
																	>
																		{speechFor(
																			p.id,
																		)}
																	</text>
																</g>
															)}
														</g>
														<text
															textAnchor="middle"
															y={
																55 * pos.scale +
																5
															}
															className="node-label"
														>
															Agent{" "}
															{short(
																p.id,
															).padStart(2, "0")}
														</text>
													</g>
												);
											})}
										</svg>
										<div className="canvas-search">
											<Search size={15} />
											<input
												aria-label="Find an agent"
												placeholder="Find an agent or idea…"
												value={query}
												onChange={(e) =>
													setQuery(e.target.value)
												}
											/>
											<span>⌕</span>
										</div>
										<div className="canvas-legend">
											<span>
												<i className="legend-dot" />{" "}
												Exploring
											</span>
											<span>
												<i className="legend-line" /> In
												conversation
											</span>
											<span>
												<i className="legend-dot green" />{" "}
												On a team
											</span>
										</div>
									</>
								) : (
									<div className="teams-view">
										<div className="eyebrow">
											WHEN POSSIBILITIES BECOME PEOPLE
										</div>
										<h2>Better, together.</h2>
										<p>
											Agent commitments from this replay.
											Your review is saved for this
											session.
										</p>
										{!state.teams.length && (
											<div className="empty-state">
												<Users size={28} />
												<h3>
													Good teams take a
													conversation.
												</h3>
												<p>
													Continue the replay to see
													teams form.
												</p>
												<button
													className="button"
													onClick={() => {
														setCursor(
															events.length,
														);
														setPlaying(false);
													}}
												>
													Jump to results{" "}
													<ArrowRight size={15} />
												</button>
											</div>
										)}
										{circles
											.filter((c) =>
												c.id.startsWith("open-"),
											)
											.map((c) => (
												<text
													key={c.id}
													x={c.x}
													y={c.titleY}
													textAnchor="middle"
													className="team-label open-group-label"
												>
													Still exploring
												</text>
											))}
										{state.teams.map((t, i) => (
											<article
												className="team-card"
												key={t.id}
											>
												<div className="team-card-top">
													<div
														className="team-avatar"
														style={{
															background:
																colors[
																	i %
																		colors.length
																],
														}}
													>
														<Users size={21} />
													</div>
													<span>{t.status}</span>
												</div>
												<h3>{t.project.title}</h3>
												<p>{t.project.description}</p>
												<div className="team-member-row">
													{t.members.map((id) => (
														<button
															key={id}
															onClick={() => {
																setSelected(id);
																setView(
																	"network",
																);
															}}
														>
															Agent {short(id)}
														</button>
													))}
												</div>
												<div className="approval-row">
													{approvals[t.id] ? (
														<span className="approval-status">
															<Check size={15} />
															{
																approvals[t.id]
															}{" "}
															locally{" "}
															<button
																onClick={() =>
																	setApprovals(
																		(a) => {
																			const next =
																				{
																					...a,
																				};
																			delete next[
																				t
																					.id
																			];
																			return next;
																		},
																	)
																}
															>
																Undo
															</button>
														</span>
													) : (
														<>
															<button
																className="button primary"
																onClick={() =>
																	setApprovals(
																		(
																			a,
																		) => ({
																			...a,
																			[t.id]:
																				"Approved",
																		}),
																	)
																}
															>
																<Check
																	size={14}
																/>{" "}
																Approve team
															</button>
															<button
																className="button"
																onClick={() =>
																	setApprovals(
																		(
																			a,
																		) => ({
																			...a,
																			[t.id]:
																				"Rejected",
																		}),
																	)
																}
															>
																Pass
															</button>
														</>
													)}
												</div>
											</article>
										))}
									</div>
								)}
							</div>
							<div className="playback">
								<div className="playback-controls">
									<button
										className="icon-button"
										title="Restart"
										onClick={() => {
											setCursor(0);
											setPlaying(false);
										}}
									>
										<RotateCcw size={16} />
									</button>
									<button
										className="icon-button"
										title="Previous event (←)"
										onClick={() => {
											setPlaying(false);
											setCursor((c) =>
												Math.max(c - 1, 0),
											);
										}}
									>
										<SkipBack size={16} />
									</button>
									<button
										className="play-button"
										aria-label={playing ? "Pause" : "Play"}
										onClick={() => {
											if (cursor === events.length)
												setCursor(0);
											setPlaying((p) => !p);
										}}
									>
										{playing ? (
											<Pause
												size={17}
												fill="currentColor"
											/>
										) : (
											<Play
												size={17}
												fill="currentColor"
											/>
										)}
									</button>
									<button
										className="icon-button"
										title="Next event (→)"
										onClick={() => {
											setPlaying(false);
											setCursor((c) =>
												Math.min(c + 1, events.length),
											);
										}}
									>
										<SkipForward size={16} />
									</button>
								</div>
								<div className="timeline">
									<div>
										<span>
											{playing
												? "Finding common ground…"
												: cursor === events.length
													? "Every connection tells a story."
													: "A world of possible connections."}
										</span>
										<span>
											{cursor}{" "}
											<b>/ {events.length} events</b>
										</span>
									</div>
									<input
										aria-label="Replay position"
										type="range"
										min="0"
										max={events.length}
										value={cursor}
										onChange={(e) => {
											setCursor(Number(e.target.value));
											setPlaying(false);
										}}
										style={
											{
												"--progress": `${(cursor / events.length) * 100}%`,
											} as React.CSSProperties
										}
									/>
								</div>
								<button
									className="speed-button"
									onClick={() =>
										setSpeed((s) =>
											s === 1 ? 2 : s === 2 ? 4 : 1,
										)
									}
								>
									{speed}× <ChevronDown size={12} />
								</button>
							</div>
						</section>
						<aside className="inspector">
							<div className="inspector-heading">
								<span>AGENT INSPECTOR</span>
								<Fingerprint size={17} />
							</div>
							{current ? (
								<>
									<div className="profile-header">
										<div className="profile-avatar">
											<AgentCharacter
												color={characterColor(
													current.id,
												)}
												level={disclosure(current.id)}
												mood={moodFor(current.id)}
												sprout
												width={72}
												height={90}
											/>
										</div>
										<h2>
											Agent{" "}
											{short(current.id).padStart(2, "0")}
										</h2>
										<span className="status-pill">
											{teamFor(current.id)
												? "Found a team"
												: "Exploring possibilities"}
										</span>
										<span className="agent-id">
											{current.id} · independent personal
											agent
										</span>
									</div>
									<div className="inspector-tabs">
										{["Overview", "Activity"].map((t) => (
											<button
												className={
													tab === t ? "selected" : ""
												}
												key={t}
												onClick={() => setTab(t)}
											>
												{t}
												{t === "Activity" && (
													<span>
														{related.length}
													</span>
												)}
											</button>
										))}
									</div>
									<div className="inspector-body">
										{tab === "Overview" ? (
											<>
												<div className="detail-label">
													<Globe2 size={13} /> PUBLIC
													LISTING <span>LEVEL 0</span>
												</div>
												<p className="pitch">
													“{current.pitch}”
												</p>
												<div className="detail-label">
													LOOKING FOR
												</div>
												<div className="role-tags">
													{current.roles.length ? (
														current.roles.map(
															(r) => (
																<span key={r}>
																	{r}
																</span>
															),
														)
													) : (
														<span>
															Open to a great idea
														</span>
													)}
												</div>
												<div className="disclosure-card">
													<div>
														<ShieldCheck
															size={16}
														/>
														<strong>
															Trust unfolds in
															stages
														</strong>
													</div>
													<p>
														Shared only after mutual
														interest.
													</p>
													{[
														"Project idea",
														"Interests & availability",
														"Skills & preferences",
														"Identity · after commitment",
													].map((label, i) => {
														const level = Math.max(
															0,
															...state.links
																.filter(
																	(l) =>
																		l.a ===
																			current.id ||
																		l.b ===
																			current.id,
																)
																.map(
																	(l) =>
																		l.level,
																),
															teamFor(current.id)
																? 3
																: 0,
														);
														return (
															<div
																className={`level-row ${i <= level ? "unlocked" : ""}`}
																key={label}
															>
																<span>
																	{i <=
																	level ? (
																		<Check
																			size={
																				11
																			}
																		/>
																	) : (
																		<LockKeyhole
																			size={
																				10
																			}
																		/>
																	)}
																</span>
																<div>
																	{label}
																</div>
																<small>
																	L{i}
																</small>
															</div>
														);
													})}
													<span className="disclosure-footnote">
														Highest level reached
														with any connection
													</span>
												</div>
												<div className="detail-label">
													CONNECTIONS{" "}
													<span>
														{
															state.links.filter(
																(l) =>
																	l.a ===
																		current.id ||
																	l.b ===
																		current.id,
															).length
														}
													</span>
												</div>
												<div className="connection-list">
													{state.links
														.filter(
															(l) =>
																l.a ===
																	current.id ||
																l.b ===
																	current.id,
														)
														.map((l) => {
															const id =
																l.a ===
																current.id
																	? l.b
																	: l.a;
															return (
																<button
																	key={id}
																	onClick={() =>
																		setSelected(
																			id,
																		)
																	}
																>
																	<span className="tiny-avatar">
																		{short(
																			id,
																		).padStart(
																			2,
																			"0",
																		)}
																	</span>
																	<div>
																		Agent{" "}
																		{short(
																			id,
																		).padStart(
																			2,
																			"0",
																		)}
																		<small>
																			{l.level >=
																			2
																				? "Exploring a shared direction"
																				: "Getting to know each other"}
																		</small>
																	</div>
																	<ChevronRight
																		size={
																			14
																		}
																	/>
																</button>
															);
														})}
													{!state.links.some(
														(l) =>
															l.a ===
																current.id ||
															l.b === current.id,
													) && (
														<p className="muted">
															Their next
															connection is still
															out there.
														</p>
													)}
												</div>
											</>
										) : (
											<>
												<div className="private-toggle">
													<Eye size={14} />
													<span>
														Operator’s private view
													</span>
													<button
														role="switch"
														aria-checked={
															privateView
														}
														aria-label="Show private rationales"
														className={
															privateView
																? "toggle on"
																: "toggle"
														}
														onClick={() =>
															setPrivate(
																(v) => !v,
															)
														}
													>
														<span />
													</button>
												</div>
												{privateView && (
													<p className="private-notice">
														Private rationales are
														for the operator. Other
														agents do not see them.
													</p>
												)}
												{related
													.slice()
													.reverse()
													.map((e, i) => (
														<div
															className="agent-activity"
															key={i}
														>
															<span className="activity-marker" />
															<p>{describe(e)}</p>
															{privateView &&
																"rationale" in
																	e &&
																e.rationale && (
																	<blockquote>
																		<LockKeyhole
																			size={
																				12
																			}
																		/>{" "}
																		{
																			e.rationale
																		}
																	</blockquote>
																)}
														</div>
													))}
												{!related.length && (
													<p className="muted">
														Play the replay to see
														activity.
													</p>
												)}
											</>
										)}
									</div>
								</>
							) : (
								<div className="empty-state">
									An agent’s story will appear here as the
									replay begins.
								</div>
							)}
							<div className="inspector-footer">
								<LockKeyhole size={12} /> Private by design.
								Curious by nature.
							</div>
						</aside>
					</div>
					<section className="activity-panel">
						<div className="activity-heading">
							<div>
								<span className="live-dot" />
								<h3>The conversation, unfolding</h3>
								<span>{feedRows.length} events</span>
							</div>
							<button
								className="feed-toggle"
								aria-pressed={showMessages}
								onClick={() => setShowMessages((v) => !v)}
							>
								{showMessages
									? "Hide messages"
									: "Show messages"}
							</button>
							<button
								onClick={() => {
									setCursor(events.length);
									setPlaying(false);
								}}
							>
								Jump to end <ArrowRight size={14} />
							</button>
						</div>
						<div className="activity-feed">
							{feedRows.map(({ e, n }) => (
								<div className="feed-row" key={n}>
									<span
										className={`feed-icon ${e.type === "level" ? "purple" : e.type === "team" ? "green" : ""}`}
									>
										{e.type === "level" ? (
											<LockKeyhole size={14} />
										) : e.type === "team" ? (
											<Users size={14} />
										) : e.type === "discovery" ? (
											<Search size={14} />
										) : (
											<GitBranch size={14} />
										)}
									</span>
									<span>{describe(e)}</span>
									<span className="event-type">{e.type}</span>
									<small>{String(n).padStart(3, "0")}</small>
								</div>
							))}
							{!feedRows.length && (
								<div className="feed-row muted">
									Press play. Let serendipity do its thing.
								</div>
							)}
						</div>
					</section>
					<footer className="page-footer">
						<span>
							<ShieldCheck size={13} /> Independent agents.
							Intentional disclosure. Human choice.
						</span>
						<span>
							AGENTMATCH EXPERIMENTS{" "}
							<span className="footer-star">✳</span> 2026
						</span>
					</footer>
				</div>
			</main>
			{showHelp && (
				<div className="modal-backdrop" onClick={() => setHelp(false)}>
					<section
						className="modal"
						role="dialog"
						aria-modal="true"
						aria-label="About this studio"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							className="modal-close icon-button"
							onClick={() => setHelp(false)}
							aria-label="Close"
						>
							<X size={20} />
						</button>
						<div className="run-icon">
							<Sparkles size={24} />
						</div>
						<h2>A front-row seat to finding your people.</h2>
						<p>
							Play, scrub, or step through a recorded agent run.
							Select any agent to explore its public listing,
							connections, and disclosure progress.
						</p>
						<p>
							Import JSONL logs locally. Files stay in this
							browser session. Private model exchanges are hidden;
							rationales are available only through the operator
							toggle.
						</p>
						<p>
							Team approvals are local UX decisions and do not
							change the engine or the recorded run.
						</p>
						<button
							className="button primary"
							onClick={() => setHelp(false)}
						>
							Let’s explore <ArrowRight size={15} />
						</button>
					</section>
				</div>
			)}
		</div>
	);
}
createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
