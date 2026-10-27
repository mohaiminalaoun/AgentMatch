// Entry point for `npm run decide`: asks the model to decide on one sample proposal, printing every message and the validated result.
import { loadConfig, readEnvFile } from "./engine/config.js";
import {
	chatJson,
	formatExchange,
	StructuredOutputError,
} from "./engine/llm.js";
import { decisionMessages } from "./engine/decision.js";
import { Decision, toResponse, type Proposal } from "./engine/proposal.js";
import { createRunLog } from "./engine/runlog.js";

const proposal: Proposal = {
	id: "prop-1",
	from: "agent-a",
	to: "agent-b",
	pitch: "A web app startup that helps freelancers send invoices.",
	rolesNeeded: ["frontend", "backend"],
};

const human =
	"Your human is a backend engineer who wants to start a climate-change non-profit.";

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("decide");
	const started = performance.now();
	const { data, usage } = await chatJson(
		config,
		decisionMessages(human, proposal),
		Decision,
		{
			onExchange: (exchange) => {
				log.write(exchange);
				console.log(`${formatExchange(exchange)}\n`);
			},
		},
	);
	const seconds = ((performance.now() - started) / 1000).toFixed(1);

	console.log("── validated response ──");
	console.log(JSON.stringify(toResponse(proposal, data), null, 2));
	const tokens = usage ? `${usage.total} tokens` : "token usage not reported";
	console.log(
		`\n${tokens} · ${seconds}s · ${config.model} · log: ${log.path}`,
	);
} catch (error) {
	if (error instanceof StructuredOutputError) {
		console.error(`${error.message}:`);
		for (const problem of error.problems) {
			console.error(`- ${problem}`);
		}
		console.error(`\nRaw reply:\n${error.raw}`);
	} else {
		console.error((error as Error).message);
	}
	process.exit(1);
}
