// Entry point for `npm run reliability`: 20 live agent decisions, run concurrently, reporting the decision mix,
// how often the gate stepped in, and a re-check that nothing sent breaks the disclosure rules.
import { createAgent } from "./engine/agent.js";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { decideOnProposal, type DecisionResult } from "./engine/decision.js";
import { checkDisclosure, draftOf } from "./engine/gate.js";
import { createRunLog } from "./engine/runlog.js";
import { proposalFor, SCENARIOS } from "./scenarios.js";

const RUNS_PER_SCENARIO = 4;

type Outcome =
	| { kind: "decided"; result: DecisionResult; formatRetries: number }
	| { kind: "error"; message: string };

readEnvFile();
const config = loadConfig(process.env);
const log = createRunLog("reliability");
const client = createLlmClient(config);
const jobs = Array.from({ length: RUNS_PER_SCENARIO }, () => SCENARIOS).flat();
let tokens = 0;
let done = 0;

console.log(
	`${jobs.length} decisions · concurrency ${config.maxConcurrency} · ${config.model}\n`,
);
const started = performance.now();
const outcomes = await Promise.all(
	jobs.map(async (scenario, i): Promise<Outcome> => {
		let formatRetries = 0;
		let outcome: Outcome;
		try {
			const result = await decideOnProposal(
				client,
				createAgent(scenario.receiver),
				proposalFor(scenario, `prop-${i + 1}`),
				{
					onExchange: (exchange) => {
						log.write(exchange);
						tokens += exchange.usage?.total ?? 0;
					},
					onRetry: (error) => {
						if (error.kind === "format") {
							formatRetries++;
						}
					},
				},
			);
			outcome = { kind: "decided", result, formatRetries };
		} catch (error) {
			outcome = { kind: "error", message: (error as Error).message };
		}
		done++;
		console.log(
			`#${String(i + 1).padStart(2)} ${scenario.name.padEnd(22)} ${label(outcome)}   (${done}/${jobs.length})`,
		);
		return outcome;
	}),
);
const seconds = (performance.now() - started) / 1000;

const decided = outcomes.flatMap((o, i) =>
	o.kind === "decided" ? [{ ...o, scenario: jobs[i]! }] : [],
);
const sent = decided.map((d) => d.result.decision);
const count = (n: number) =>
	`${String(n).padStart(2)}/${jobs.length}  (${Math.round((n / jobs.length) * 100)}%)`;
const blocks = decided.reduce((sum, d) => sum + d.result.gateBlocks, 0);
// Independent re-check of what was actually sent, at the level it was sent at (0 for a first contact).
const rulesBroken = decided.filter(
	(d) =>
		checkDisclosure(d.scenario.receiver, 0, draftOf(d.result.decision))
			.length > 0,
).length;
const declines = sent.filter((d) => d.decision === "decline");
const reasons = declines.flatMap((d) => (d.reason?.trim() ? [d.reason] : []));

console.log(`
Decided:                 ${count(decided.length)}
Fell back (plain decline): ${decided.filter((d) => d.result.fellBack).length}
Request errors:          ${outcomes.length - decided.length}
Format retries:          ${decided.reduce((sum, d) => sum + d.formatRetries, 0)}

Decisions:  ${(["accept", "counter", "decline"] as const)
	.map((k) => `${k} ${sent.filter((d) => d.decision === k).length}`)
	.join(" · ")}
${SCENARIOS.map(
	(s) =>
		`  ${s.name.padEnd(22)} ${decided
			.filter((d) => d.scenario === s)
			.map((d) => d.result.decision.decision)
			.join(", ")}`,
).join("\n")}

Gate blocks:             ${blocks}   (things the model tried to send that the rules forbid)
Rule-breaking messages sent: ${rulesBroken}
Declines that gave a reason: ${reasons.length}/${declines.length}

Tokens:     ${tokens}   (avg ${Math.round(tokens / jobs.length)} per decision)
Wall time:  ${seconds.toFixed(1)}s
Log:        ${log.path}`);

if (reasons.length > 0) {
	console.log("\nDecline reasons that passed the gate and were sent:");
	for (const reason of reasons) {
		console.log(`  - ${reason}`);
	}
}
for (const o of outcomes) {
	if (o.kind === "error") {
		console.log(`  ✗ ${o.message.split("\n")[0]}`);
	}
}

// One short label for a decision's outcome in the progress lines.
function label(outcome: Outcome): string {
	if (outcome.kind === "error") {
		return "request error ✗";
	}
	const { result } = outcome;
	const extras = [
		...(result.gateBlocks > 0 ? [`gate blocked ${result.gateBlocks}`] : []),
		...(result.fellBack ? ["fell back"] : []),
	];
	return `${result.decision.decision}${extras.length > 0 ? `  (${extras.join(", ")})` : ""}`;
}
