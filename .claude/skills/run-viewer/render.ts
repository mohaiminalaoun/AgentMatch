// Renders a run log from runs/ as one self-contained, filterable HTML page: every event, conversation,
// decision, and private rationale, plus each model call's full prompt and reply. Usage:
//   npx tsx .claude/skills/run-viewer/render.ts <log.jsonl> [--out <file.html>] [--no-prompts]
// The page holds everything in the log, private rationales included, so it's written next to the log in
// runs/ (gitignored) by default.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatEvent } from "../../../src/describe.js";
import type { RunEvent } from "../../../src/engine/events.js";
import { readRunLog } from "../../../src/engine/runlog.js";
import { callOf } from "../../../src/evaluation/explain.js";

const args = process.argv.slice(2);
const log = args.find((a) => !a.startsWith("--"));
if (!log) {
	console.error(
		"Usage: npx tsx .claude/skills/run-viewer/render.ts <log.jsonl> [--out <file.html>] [--no-prompts]",
	);
	process.exit(1);
}
const outIndex = args.indexOf("--out");
const out =
	outIndex >= 0 && args[outIndex + 1]
		? args[outIndex + 1]!
		: join(dirname(log), `${basename(log, ".jsonl")}.html`);
const prompts = !args.includes("--no-prompts");

const events = readRunLog(log);
const agents = [
	...new Set(events.flatMap((e) => (e.type === "round" ? e.agents : []))),
].sort();
const known = new Set(agents);

// A proposal id is "<r|b><round>-<from>-<to>" plus ".c" per counter; ids may hold dashes, so split
// where both halves are known agents.
function pairOf(proposalId: string): string[] {
	const body = proposalId.replace(/^[a-z]+\d+-/, "").replace(/(\.c)+$/, "");
	for (let i = body.indexOf("-"); i >= 0; i = body.indexOf("-", i + 1)) {
		const a = body.slice(0, i);
		const b = body.slice(i + 1);
		if (known.has(a) && known.has(b)) {
			return [a, b];
		}
	}
	return [];
}

type Row = {
	i: number;
	type: string;
	round: number;
	tick: number;
	phase: string;
	agents: string[];
	level?: number;
	text: string;
	rationale?: string | undefined;
	flags: string[];
	call?: {
		kind: string;
		messages: { role: string; content: string }[];
		reply: string;
		usage?: unknown;
	};
	time?: string;
};

let round = 0;
let tick = 0;
let phase = "rounds";
const rows: Row[] = [];
events.forEach((e, i) => {
	if (e.type === "round") {
		round++;
		tick = 0;
	}
	if (e.type === "tick") {
		tick = e.n;
	}
	if (e.type === "brainstorm") {
		phase = "brainstorm";
	}
	const base = { i, type: e.type, round, tick, phase, flags: [] as string[] };
	const flags = (x: {
		fellBack?: boolean | undefined;
		gateBlocks?: number | undefined;
	}) => [
		...(x.fellBack ? ["fell back"] : []),
		...(x.gateBlocks ? [`gate blocked ${x.gateBlocks}`] : []),
	];
	const text = formatEvent(e, { rationale: false })?.trim() ?? "";
	switch (e.type) {
		case "exchange": {
			if (!prompts) {
				return;
			}
			// Exchanges don't record their agent or kind, so both are inferred from the prompt.
			const { kind, agent } = callOf(e);
			rows.push({
				...base,
				type: "model call",
				agents: agent ? [agent] : [],
				text: `${agent ?? "?"} · ${kind} call`,
				time: e.time,
				call: {
					kind,
					messages: e.messages,
					reply: e.reply,
					usage: e.usage,
				},
			});
			return;
		}
		case "bus": {
			const b = e.event;
			const level =
				b.type === "sent" && "level" in b.message
					? Number(b.message.level)
					: undefined;
			rows.push({
				...base,
				type: b.type === "sent" ? "message" : "rejected",
				agents:
					b.type === "sent"
						? [b.message.from, b.message.to]
						: [b.from],
				...(level !== undefined && { level }),
				text,
				time: b.time,
			});
			return;
		}
		case "decision":
			rows.push({
				...base,
				agents: [
					e.agent,
					...pairOf(e.proposalId).filter((a) => a !== e.agent),
				],
				text,
				rationale: e.rationale,
				flags: flags(e),
			});
			return;
		case "interest":
		case "hunch":
		case "revisionAnswer":
			rows.push({
				...base,
				agents: [e.agent, e.other],
				...("level" in e && { level: e.level }),
				text,
				rationale: e.rationale,
				flags: flags(e),
			});
			return;
		case "level":
			rows.push({
				...base,
				agents: [e.agent, e.other],
				level: e.to,
				text,
			});
			return;
		case "listing":
		case "discovery":
		case "recheck":
			rows.push({
				...base,
				agents: [
					e.agent,
					...(e.type === "discovery" ? e.approach : []),
				],
				text,
				rationale: e.rationale,
				flags: flags(e),
			});
			return;
		case "offers":
			rows.push({
				...base,
				agents: [e.agent, ...e.to],
				text,
				rationale: e.rationale,
				flags: flags(e),
			});
			return;
		case "commitment":
			rows.push({
				...base,
				agents: [e.agent, ...e.offers],
				text,
				rationale: e.rationale,
				flags: flags(e),
			});
			return;
		case "team":
			rows.push({ ...base, agents: e.team.members, text });
			return;
		case "brainstorm":
			rows.push({ ...base, agents: e.agents, text });
			return;
		case "round":
			rows.push({
				...base,
				agents: [],
				text: `round ${round} · ${e.model}`,
				time: e.time,
			});
			return;
		case "tick":
		case "stopped":
			rows.push({ ...base, agents: [], text });
			return;
	}
});

// Final teams, and every pair that exchanged messages: how far they got and how it ended.
const teams = new Map<string, Extract<RunEvent, { type: "team" }>["team"]>();
for (const e of events) {
	if (e.type === "team") {
		teams.set(e.team.id, e.team);
	}
}
const teamOf = new Map<string, string>();
for (const t of teams.values()) {
	for (const m of t.members) {
		teamOf.set(m, t.id);
	}
}
const pairs = new Map<
	string,
	{
		a: string;
		b: string;
		messages: number;
		level: number;
		withdrew: string[];
	}
>();
const pairKey = (x: string, y: string) => [x, y].sort().join("|");
for (const e of events) {
	if (e.type === "bus" && e.event.type === "sent") {
		const { from, to } = e.event.message;
		const key = pairKey(from, to);
		const p = pairs.get(key) ?? {
			a: [from, to].sort()[0]!,
			b: [from, to].sort()[1]!,
			messages: 0,
			level: 0,
			withdrew: [],
		};
		p.messages++;
		pairs.set(key, p);
	}
	if (e.type === "level") {
		const p = pairs.get(pairKey(e.agent, e.other));
		if (p) {
			p.level = Math.max(p.level, e.to);
		}
	}
	if (e.type === "interest" && e.interest === "withdraw") {
		pairs
			.get(pairKey(e.agent, e.other))
			?.withdrew.push(`${e.agent} at level ${e.level}`);
	}
}
const conversations = [...pairs.values()].map((p) => ({
	...p,
	together:
		teamOf.get(p.a) !== undefined && teamOf.get(p.a) === teamOf.get(p.b),
}));

const model = events.find((e) => e.type === "round");
const data = {
	file: basename(log),
	model: model?.type === "round" ? model.model : "",
	agents,
	teams: [...teams.values()],
	unplaced: agents.filter((a) => !teamOf.has(a)),
	conversations,
	rows,
	prompts,
};

const template = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "viewer.html"),
	"utf8",
);
const json = JSON.stringify(data).replace(/</g, "\\u003c");
writeFileSync(
	out,
	template
		.replace("__TITLE__", basename(log, ".jsonl"))
		.replace("__DATA__", () => json),
);
console.log(
	`Wrote ${out} (${rows.length} rows, ${teams.size} teams, ${conversations.length} conversations${prompts ? "" : ", no model calls"})`,
);
