import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileUp, RefreshCw, Save, Trash2, Users, Wand2 } from "lucide-react";
import example from "../../../profiles/example.json";
import { checkPerson, newPersonId } from "../../pilot/person.js";
import type { PersonSummary } from "../../pilot/people.js";
import "./people.css";

// What the server says back: whoever was saved, or what's wrong.
type SaveResult = { saved: PersonSummary } | { problems: string[] };

// Reads `text` as one person: their summary if valid, or every problem with it.
function check(text: string) {
	if (text.trim() === "") {
		return undefined;
	}
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (error) {
		return { problems: [`Not valid JSON: ${(error as Error).message}`] };
	}
	return checkPerson(json);
}

// What to say when /api/people isn't there: a dev server started before vite.config.ts existed
// never mounts it, and a built copy of the page has no server behind it at all.
const NO_API =
	"The People endpoint isn't running. Restart the dev server with npm run dev:ui and try again.";

// Reads a response as JSON from /api/people, or undefined if the endpoint didn't answer it.
async function api<T>(res: Response): Promise<T | undefined> {
	if (!res.headers.get("Content-Type")?.includes("application/json")) {
		return undefined;
	}
	return res.json();
}

async function save(text: string, replace = false): Promise<SaveResult> {
	const res = await fetch("/api/people", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ person: JSON.parse(text), replace }),
	});
	return (await api<SaveResult>(res)) ?? { problems: [NO_API] };
}

const pretty = (json: unknown) => JSON.stringify(json, null, 2);
const levelName = (level: number | "never") =>
	level === "never" ? "never shared" : `level ${level}`;

function People() {
	const [text, setText] = useState("");
	const [people, setPeople] = useState<PersonSummary[]>([]);
	// The outcome of the last save or upload, one line per file or person.
	const [outcome, setOutcome] = useState<
		{ ok: boolean; text: string; problems?: string[] }[]
	>([]);
	// Set when the id is taken by the same person's file, so saving again replaces it.
	const [canReplace, setCanReplace] = useState(false);
	// The id whose Remove button was pressed once and now asks to confirm.
	const [removing, setRemoving] = useState("");
	const upload = useRef<HTMLInputElement>(null);
	const checked = check(text);
	// Whether the editor holds JSON at all, valid person or not: then a new id can go in.
	const isJson = (() => {
		try {
			JSON.parse(text);
			return true;
		} catch {
			return false;
		}
	})();

	// Set when the endpoint isn't there, so the page says so before anyone tries to save.
	const [apiMissing, setApiMissing] = useState(false);
	const refresh = async () => {
		const list = await api<PersonSummary[]>(await fetch("/api/people"));
		setApiMissing(!list);
		setPeople(list ?? []);
	};
	useEffect(() => {
		void refresh();
	}, []);
	useEffect(() => setCanReplace(false), [text]);

	const onSave = async () => {
		const result = await save(text, canReplace);
		if ("saved" in result) {
			setOutcome([
				{
					ok: true,
					text: `Saved ${result.saved.name} as profiles/${result.saved.file}`,
				},
			]);
			setText("");
			await refresh();
		} else {
			setOutcome([
				{ ok: false, text: "Not saved", problems: result.problems },
			]);
			setCanReplace(
				result.problems.some((p) =>
					p.includes("save again to replace"),
				),
			);
		}
	};

	// One file goes into the editor to check and save; several are saved at once, each reported.
	const onUpload = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		if (files.length === 1) {
			setText(await files[0]!.text());
			setOutcome([]);
		} else {
			const results = await Promise.all(
				[...files].map(async (file) => {
					const content = await file.text();
					const problems = check(content)?.problems;
					if (problems) {
						return { ok: false, text: file.name, problems };
					}
					const result = await save(content);
					return "saved" in result
						? {
								ok: true,
								text: `${file.name} → saved ${result.saved.name}`,
							}
						: {
								ok: false,
								text: file.name,
								problems: result.problems,
							};
				}),
			);
			setOutcome(results);
			await refresh();
		}
		if (upload.current) upload.current.value = "";
	};

	const newId = () => {
		try {
			const json = JSON.parse(text);
			json.profile = { ...json.profile, id: newPersonId() };
			setText(pretty(json));
		} catch {
			// Not JSON yet: nothing to put an id in.
		}
	};

	const remove = async (id: string) => {
		if (removing !== id) {
			setRemoving(id);
			return;
		}
		await fetch(`/api/people/${encodeURIComponent(id)}`, {
			method: "DELETE",
		});
		setRemoving("");
		await refresh();
	};

	return (
		<main className="people-page">
			<header>
				<a href="/">AgentMatch</a>
				<h1>
					<Users size={20} /> People in the pilot
				</h1>
				<p>
					Add each real person as one profile: paste their JSON or
					upload files. Profiles are checked against the same rules as{" "}
					<code>pilot:run</code> and saved in <code>profiles/</code>,
					which stays on this machine and out of git.
				</p>
			</header>

			<section className="people-editor" aria-label="Add a person">
				{apiMissing && (
					<div className="people-check bad" role="alert">
						{NO_API}
					</div>
				)}
				<div className="people-actions">
					<button
						onClick={() =>
							setText(
								pretty({
									...example,
									profile: {
										...example.profile,
										id: newPersonId(),
									},
								}),
							)
						}
					>
						<Wand2 size={14} /> Start from the example
					</button>
					<button onClick={() => upload.current?.click()}>
						<FileUp size={14} /> Upload .json files
					</button>
					<input
						ref={upload}
						type="file"
						accept=".json,application/json"
						multiple
						hidden
						onChange={(e) => void onUpload(e.target.files)}
					/>
					<button onClick={newId} disabled={!isJson}>
						<RefreshCw size={14} /> New random id
					</button>
				</div>
				<textarea
					aria-label="Person JSON"
					spellCheck={false}
					placeholder='Paste one person here: { "profile": { … }, "notes": [ … ], "contact": "…" }'
					value={text}
					onChange={(e) => {
						setText(e.target.value);
						setOutcome([]);
					}}
				/>
				{checked &&
					(checked.problems ? (
						<div className="people-check bad" role="status">
							<strong>
								{checked.problems.length} problem
								{checked.problems.length === 1 ? "" : "s"} to
								fix
							</strong>
							<ul>
								{checked.problems.map((p) => (
									<li key={p}>{p}</li>
								))}
							</ul>
						</div>
					) : (
						<div className="people-check good" role="status">
							<strong>
								Looks good: {checked.person.profile.name} (
								{checked.person.profile.id})
							</strong>
							<span>
								{checked.person.profile.skills
									.map((s) => `${s.name} (${s.level})`)
									.join(", ")}
								{" · "}
								{checked.person.notes.length === 0
									? "no notes"
									: checked.person.notes
											.map((n) => levelName(n.level))
											.join(", ")}
								{" · "}
								{checked.person.contact
									? "has contact"
									: "no contact"}
							</span>
						</div>
					))}
				<button
					className="people-save"
					disabled={!checked || !!checked.problems}
					onClick={() => void onSave()}
				>
					<Save size={14} />{" "}
					{canReplace ? "Replace their saved profile" : "Save"}
				</button>
				{outcome.length > 0 && (
					<ul className="people-outcome" role="status">
						{outcome.map((o) => (
							<li key={o.text} className={o.ok ? "good" : "bad"}>
								{o.text}
								{o.problems && (
									<ul>
										{o.problems.map((p) => (
											<li key={p}>{p}</li>
										))}
									</ul>
								)}
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="people-list" aria-label="Saved people">
				<h2>
					Saved <span>{people.length}</span>
				</h2>
				{people.length === 0 ? (
					<p className="people-empty">Nobody yet.</p>
				) : (
					<ul>
						{people.map((p) => (
							<li key={p.id}>
								<div>
									<strong>{p.name}</strong>{" "}
									<code>{p.id}</code>
									<span>
										{p.skills.join(", ")} · {p.notes} note
										{p.notes === 1 ? "" : "s"} · {p.file}
									</span>
								</div>
								<button
									className={
										removing === p.id ? "confirm" : ""
									}
									onClick={() => void remove(p.id)}
									onBlur={() => setRemoving("")}
									aria-label={`Remove ${p.name}`}
								>
									<Trash2 size={14} />
									{removing === p.id
										? "Click again to remove"
										: "Remove"}
								</button>
							</li>
						))}
					</ul>
				)}
				<p className="people-next">
					When everyone's in, run{" "}
					<code>npm run pilot:run -- profiles/ --fill 16</code> with a
					regular (not <code>-contributor</code>) model.
				</p>
			</section>
		</main>
	);
}

createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<People />
	</React.StrictMode>,
);
