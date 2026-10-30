// Entry point for `npm run eval:explain -- <log> [--per-kind N --seed S]`: samples up to N model calls of each
// kind from a run log, has a judge model check every claim in each private rationale against the prompt the
// agent was given, and prints a table per call kind (supported, unsupported, contradicted; asserted or
// tentative). Saves every judgment next to the log in runs/, which is gitignored, since it quotes rationales.
// Costs real credits: one call per sampled rationale.
import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { readRunLog } from "./engine/runlog.js";
import {
	explainedCalls,
	formatExplainTable,
	judgeCalls,
	sampleCalls,
	summarizeJudgments,
} from "./evaluation/explain.js";
import { assertRealDataModel } from "./pilot/model.js";
import { createStatus } from "./status.js";

function flag(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const log = process.argv
	.slice(2)
	.find(
		(arg, i, args) =>
			!arg.startsWith("--") && !args[i - 1]?.startsWith("--"),
	);
const perKind = Number(flag("per-kind", "5"));
const seed = Number(flag("seed", "1"));

if (!log || !Number.isInteger(perKind) || perKind < 1) {
	console.error("Usage: npm run eval:explain -- <log> --per-kind N --seed S");
	process.exit(1);
}

// Generated people have ids like p7; anyone else in the log may be a real person.
const GENERATED_ID = /^p\d+$/;

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const events = readRunLog(log);
	const agents = events.flatMap((e) => (e.type === "round" ? e.agents : []));
	if (agents.some((id) => !GENERATED_ID.test(id))) {
		// The judge sees each prompt in full, so real people's data reaches it.
		assertRealDataModel(config);
	}
	const calls = sampleCalls(explainedCalls(events), perKind, seed);
	console.log(
		`${basename(log)} · ${calls.length} rationales sampled (up to ${perKind} per kind, seed ${seed}) · judge: ${config.model}\n`,
	);
	const client = createLlmClient(config);
	const started = performance.now();
	let done = 0;
	const status = createStatus(started, () => `${done}/${calls.length}`);
	const { judged, failed } = await judgeCalls(client, calls, () => {
		done++;
		status.call(0);
	});
	status.stop();
	console.log(
		formatExplainTable(
			summarizeJudgments(
				judged.map(({ call, judgment }) => ({
					kind: call.kind,
					claims: judgment.claims,
				})),
			),
		),
	);
	if (failed > 0) {
		console.log(`\n${failed} judgment(s) failed and were left out.`);
	}
	const out = join(dirname(log), `${basename(log, ".jsonl")}.explain.json`);
	writeFileSync(
		out,
		`${JSON.stringify(
			{
				log: basename(log),
				judge: config.model,
				perKind,
				seed,
				judged: judged.map(({ call, judgment }) => ({
					index: call.index,
					agent: call.agent,
					kind: call.kind,
					rationale: call.rationale,
					claims: judgment.claims,
				})),
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(
		`\nEvery judgment: ${out} (gitignored; it quotes private rationales)`,
	);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
