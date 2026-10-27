// Entry point for `npm run reliability`: makes 20 live decision calls and reports how often the model's JSON was valid.
import { loadConfig, readEnvFile } from "./engine/config.js";
import { decisionMessages } from "./engine/decision.js";
import { chatJson, StructuredOutputError } from "./engine/llm.js";
import { Decision, type Proposal } from "./engine/proposal.js";
import { createRunLog } from "./engine/runlog.js";

const RUNS_PER_SCENARIO = 4;

// Chosen so accept, counter, and decline all come up; counters are the hardest shape.
const SCENARIOS: {
	name: string;
	human: string;
	pitch: string;
	roles: string[];
}[] = [
	{
		name: "invoicing vs climate",
		human: "Your human is a backend engineer who wants to start a climate-change non-profit.",
		pitch: "A web app startup that helps freelancers send invoices.",
		roles: ["frontend", "backend"],
	},
	{
		name: "carbon tracker",
		human: "Your human is a backend engineer who wants to start a climate-change non-profit.",
		pitch: "An open-source app that estimates a household's carbon footprint from receipts.",
		roles: ["backend", "design"],
	},
	{
		name: "student notes",
		human: "Your human is a frontend developer who cares about accessibility and education.",
		pitch: "An AI note-taking app for university students.",
		roles: ["frontend", "ml"],
	},
	{
		name: "crypto bot",
		human: "Your human is an ML engineer interested in finance who only works on open-source projects.",
		pitch: "A closed-source crypto trading bot that predicts prices.",
		roles: ["ml", "backend"],
	},
	{
		name: "music game",
		human: "Your human is a product designer who loves music and multiplayer games.",
		pitch: "A multiplayer rhythm game where friends make music together.",
		roles: ["design", "frontend"],
	},
];

type Outcome =
	| { kind: "valid"; decision: Decision; attempts: number }
	| { kind: "invalid"; problems: string[] }
	| { kind: "error"; message: string };

readEnvFile();
const config = loadConfig(process.env);
const log = createRunLog("reliability");
const results: {
	scenario: string;
	outcome: Outcome;
	retryProblems: string[];
}[] = [];
let totalTokens = 0;
let totalSeconds = 0;
const total = SCENARIOS.length * RUNS_PER_SCENARIO;

console.log(`${total} calls · ${config.model}\n`);
for (let run = 0; run < RUNS_PER_SCENARIO; run++) {
	for (const scenario of SCENARIOS) {
		const proposal: Proposal = {
			id: `prop-${results.length + 1}`,
			from: "agent-a",
			to: "agent-b",
			pitch: scenario.pitch,
			rolesNeeded: scenario.roles,
		};
		const retryProblems: string[] = [];
		let callTokens = 0;
		const started = performance.now();
		let outcome: Outcome;
		try {
			const { data, attempts } = await chatJson(
				config,
				decisionMessages(scenario.human, proposal),
				Decision,
				{
					// Counted per exchange, so failed attempts' tokens are included too.
					onExchange: (exchange) => {
						log.write(exchange);
						callTokens += exchange.usage?.total ?? 0;
					},
					onRetry: (error) => retryProblems.push(...error.problems),
				},
			);
			outcome = { kind: "valid", decision: data, attempts };
		} catch (error) {
			outcome =
				error instanceof StructuredOutputError
					? { kind: "invalid", problems: error.problems }
					: { kind: "error", message: (error as Error).message };
		}
		const seconds = (performance.now() - started) / 1000;
		totalTokens += callTokens;
		totalSeconds += seconds;
		results.push({ scenario: scenario.name, outcome, retryProblems });
		console.log(
			`#${String(results.length).padStart(2)} ${scenario.name.padEnd(22)} ${describe(outcome).padEnd(28)} ${callTokens} tok · ${seconds.toFixed(1)}s`,
		);
	}
}

const valid = results.flatMap((r) =>
	r.outcome.kind === "valid" ? [r.outcome] : [],
);
const count = (n: number) =>
	`${String(n).padStart(2)}/${total}  (${Math.round((n / total) * 100)}%)`;
const declines = valid.flatMap((o) =>
	o.decision.decision === "decline" ? [o.decision] : [],
);
const withReason = declines.filter((d) => d.reason?.trim());

console.log(`
Valid on first try:      ${count(valid.filter((o) => o.attempts === 1).length)}
Valid after a retry:     ${count(valid.filter((o) => o.attempts > 1).length)}
Invalid after retries:   ${count(results.filter((r) => r.outcome.kind === "invalid").length)}
Request errors:          ${count(results.filter((r) => r.outcome.kind === "error").length)}

Decisions:  ${(["accept", "counter", "decline"] as const)
	.map((d) => `${d} ${valid.filter((o) => o.decision.decision === d).length}`)
	.join(" · ")}
Declines that gave a reason:  ${withReason.length}/${declines.length}

Avg tokens per call:  ${Math.round(totalTokens / total)}   (total ${totalTokens})
Avg time per call:    ${(totalSeconds / total).toFixed(1)}s
Log:                  ${log.path}`);

const problems = results.filter(
	(r) => r.retryProblems.length > 0 || r.outcome.kind !== "valid",
);
if (problems.length > 0) {
	console.log("\nProblems:");
	for (const r of problems) {
		const n = results.indexOf(r) + 1;
		for (const p of r.retryProblems) {
			console.log(`  #${n} (fixed by retry) ${p}`);
		}
		if (r.outcome.kind === "invalid") {
			for (const p of r.outcome.problems) {
				console.log(`  #${n} (gave up) ${p}`);
			}
		}
		if (r.outcome.kind === "error") {
			console.log(`  #${n} (request error) ${r.outcome.message}`);
		}
	}
}

if (withReason.length > 0) {
	console.log(
		"\nDecline reasons sent to the proposer (what would leak today):",
	);
	for (const d of withReason) {
		console.log(`  - ${d.reason}`);
	}
}

// One short label for a call's outcome in the progress lines.
function describe(outcome: Outcome): string {
	if (outcome.kind === "valid") {
		const tries =
			outcome.attempts === 1 ? "1 try" : `${outcome.attempts} tries`;
		return `${outcome.decision.decision} ✓ (${tries})`;
	}
	return outcome.kind === "invalid" ? "invalid ✗" : "request error ✗";
}
