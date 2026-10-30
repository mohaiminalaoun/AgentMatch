// Entry point for `npm run baseline -- <label> <log> [<log> ...]`: freezes one record of how the agents do,
// so later changes can be compared with it: the eval table (results/eval.json), the explanation checker's
// summary per log (each log's .explain.json, from `npm run eval:explain`), the newest regression results in
// runs/, and the decision check of each log. Saves results/baseline-<label>.json. Only synthetic logs, since
// results/ is in git. No model calls.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readRunLog, RUNS_DIR } from "./engine/runlog.js";
import { checkDecisions } from "./evaluation/decisions.js";
import {
	formatExplainTable,
	JudgmentFile,
	summarizeJudgments,
} from "./evaluation/explain.js";

const [label, ...logs] = process.argv.slice(2);
if (!label || !/^[\w-]+$/.test(label) || logs.length === 0) {
	console.error("Usage: npm run baseline -- <label> <log> [<log> ...]");
	process.exit(1);
}

// Generated people have ids like p7; anyone else may be a real person, who must never reach results/.
const GENERATED_ID = /^p\d+$/;

try {
	const perLog = logs.map((log) => {
		const events = readRunLog(log);
		const people = events.flatMap((e) =>
			e.type === "round" ? e.agents : [],
		);
		if (people.some((id) => !GENERATED_ID.test(id))) {
			throw new Error(
				`${basename(log)} has people who aren't generated; only synthetic runs go in results/.`,
			);
		}
		const explainPath = join(
			dirname(log),
			`${basename(log, ".jsonl")}.explain.json`,
		);
		const explain = JudgmentFile.parse(
			JSON.parse(readFileSync(explainPath, "utf8")),
		);
		const decisions = checkDecisions(events);
		const findings: Record<string, number> = {};
		for (const f of decisions.findings) {
			findings[f.kind] = (findings[f.kind] ?? 0) + 1;
		}
		return {
			log: basename(log),
			judged: explain.judged,
			judge: explain.judge,
			decisions: {
				teams: decisions.teams,
				placed: decisions.placed,
				people: decisions.people,
				fellBack: decisions.fellBack,
				findings,
			},
		};
	});

	const explainAll = summarizeJudgments(perLog.flatMap((l) => l.judged));
	const regressionFile = readdirSync(RUNS_DIR)
		.filter((name) => name.endsWith("-regressions.json"))
		.sort()
		.at(-1);
	const regressions = regressionFile
		? JSON.parse(readFileSync(join(RUNS_DIR, regressionFile), "utf8"))
		: undefined;
	const evalTable = JSON.parse(readFileSync("results/eval.json", "utf8"));
	const totals: Record<string, number> = {};
	for (const l of perLog) {
		for (const [kind, n] of Object.entries(l.decisions.findings)) {
			totals[kind] = (totals[kind] ?? 0) + n;
		}
	}

	const record = {
		label,
		date: new Date().toISOString(),
		eval: evalTable,
		explain: {
			judge: perLog[0]!.judge,
			all: explainAll,
			perLog: perLog.map((l) => ({
				log: l.log,
				summary: summarizeJudgments(l.judged),
			})),
		},
		regressions: regressions && {
			file: regressionFile,
			model: regressions.model,
			runs: regressions.runs,
			cases: (
				regressions.results as {
					name: string;
					runs: number;
					failed: number;
					errors: number;
				}[]
			).map(({ name, runs, failed, errors }) => ({
				name,
				runs,
				failed,
				errors,
			})),
		},
		decisions: {
			totals,
			perLog: perLog.map((l) => ({ log: l.log, ...l.decisions })),
		},
	};
	const out = `results/baseline-${label}.json`;
	writeFileSync(out, `${JSON.stringify(record, null, "\t")}\n`);

	console.log(
		`Explanations over ${logs.length} logs (judge ${record.explain.judge}):\n`,
	);
	console.log(formatExplainTable(explainAll));
	if (record.regressions) {
		console.log(`\nRegressions (${regressionFile}):`);
		for (const c of record.regressions.cases) {
			console.log(`  ${c.name}: failed ${c.failed}/${c.runs}`);
		}
	}
	console.log(
		`\nDecision findings over ${logs.length} logs: ${
			Object.entries(totals)
				.map(([k, n]) => `${k} ${n}`)
				.join(" · ") || "none"
		}`,
	);
	console.log(`\nSaved: ${out}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
