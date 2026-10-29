// Entry point for `npm run hunch`: Lena pitches a fitness app to Rafa, a mobile developer into fitness. Rafa's
// agent decides twice: once knowing only his profile, and once with his "never" note (a failed jiu-jitsu app).
// The note goes only into a private hunch call, which can steer the decision with a few fixed words and
// nothing else. Prints both decisions side by side and checks that the note never reaches what's sent.
import { createAgent } from "./engine/agent.js";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { decideOnProposal, type DecisionResult } from "./engine/decision.js";
import { exchangeEvent } from "./engine/events.js";
import { getHunch } from "./engine/hunch.js";
import { createRunLog } from "./engine/runlog.js";
import { lenaPitch, rafa, rafaNotes } from "./scenarios.js";

// What a decision sends, as one line.
function sent(result: DecisionResult): string {
	const d = result.decision;
	return d.decision === "counter"
		? `counter: "${d.pitch}" (needs ${d.rolesNeeded.join(", ")})`
		: d.decision;
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("hunch");
	const client = createLlmClient(config);
	const options = {
		onExchange: (exchange: Parameters<typeof exchangeEvent>[0]) =>
			log.write(exchangeEvent(exchange)),
	};

	console.log(
		`Lena pitches: "${lenaPitch.pitch}" (needs ${lenaPitch.rolesNeeded.join(", ")})\n`,
	);

	const plain = await decideOnProposal(
		client,
		createAgent(rafa),
		lenaPitch,
		options,
	);
	console.log("Rafa's agent, profile only:");
	console.log(`  sends:   ${sent(plain)}`);
	console.log(`  private: ${plain.rationale ?? "(none)"}\n`);

	const deep = createAgent(rafa, rafaNotes);
	const hunch = await getHunch(
		client,
		deep,
		lenaPitch.from,
		`They propose: ${JSON.stringify({ pitch: lenaPitch.pitch, rolesNeeded: lenaPitch.rolesNeeded })}. Your agent will accept, counter, or decline.`,
		options,
	);
	const steered = await decideOnProposal(
		client,
		deep,
		lenaPitch,
		options,
		hunch,
	);
	console.log(`Rafa's agent, with his "never" note: "${rafaNotes[0]!.text}"`);
	console.log(
		`  private hunch: ${hunch?.steer}${hunch?.riskArea ? ` (${hunch.riskArea})` : ""} · ${hunch?.rationale ?? "(none)"}`,
	);
	console.log(`  sends:   ${sent(steered)}`);
	console.log(`  private: ${steered.rationale ?? "(none)"}\n`);

	const leaked = /jiu|jitsu|martial/i.test(JSON.stringify(steered.decision));
	console.log(
		leaked
			? "LEAK: the note's subject appears in what was sent."
			: "Check: nothing sent mentions jiu-jitsu; only the steer crossed over, as fixed text.",
	);
	console.log(`Run log: ${log.path}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
