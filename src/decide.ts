// Entry point for `npm run decide [scenario]`: one agent decides on one sample proposal, printing every message,
// its private rationale, any gate blocks, and what would actually be sent.
import { createAgent } from "./engine/agent.js";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { decideOnProposal } from "./engine/decision.js";
import { formatExchange } from "./engine/llm.js";
import { toResponse } from "./engine/proposal.js";
import { createRunLog } from "./engine/runlog.js";
import { proposalFor, SCENARIOS } from "./scenarios.js";

const index = Number(process.argv[2] ?? 1) - 1;
const scenario = SCENARIOS[index];
if (!scenario) {
	console.error(
		`Usage: npm run decide [1-${SCENARIOS.length}]\n${SCENARIOS.map((s, i) => `  ${i + 1}. ${s.name}`).join("\n")}`,
	);
	process.exit(1);
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("decide");
	const client = createLlmClient(config);
	const agent = createAgent(scenario.receiver);
	const proposal = proposalFor(scenario, "prop-1");
	const started = performance.now();

	const result = await decideOnProposal(client, agent, proposal, {
		onExchange: (exchange) => {
			log.write(exchange);
			console.log(`${formatExchange(exchange)}\n`);
		},
	});
	const seconds = ((performance.now() - started) / 1000).toFixed(1);

	console.log(
		`── private rationale (for ${agent.profile.name} only, never sent) ──`,
	);
	console.log(result.rationale ?? "(none: no valid reply came back)");
	console.log(`\n── sent to ${proposal.from} ──`);
	console.log(JSON.stringify(toResponse(proposal, result.decision), null, 2));

	const notes = [
		`gate blocks: ${result.gateBlocks}`,
		...(result.fellBack ? ["fell back to a plain decline"] : []),
		result.usage ? `${result.usage.total} tokens` : "tokens not reported",
		`${seconds}s`,
		config.model,
		`log: ${log.path}`,
	];
	console.log(`\n${scenario.name} · ${notes.join(" · ")}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
