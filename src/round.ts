// Entry point for `npm run round`: one live round on the bus. Ivan proposes his project to Ben, Ben's agent
// decides, and the reply comes back, printing each phase and both agents' state afterwards.
import { contactOf } from "./engine/agent.js";
import { describeMessage } from "./describe.js";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { createWorld, proposalFrom, runRound } from "./engine/round.js";
import { createRunLog } from "./engine/runlog.js";
import { ben, ivan } from "./scenarios.js";

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("round");
	const client = createLlmClient(config);
	const world = createWorld([ivan, ben]);

	world.bus.subscribe((event) => {
		if (event.type === "rejected") {
			console.log(`  ✗ bus rejected: ${event.reason}`);
			return;
		}
		const m = event.message;
		console.log(
			`  bus #${event.seq}  ${m.from} → ${m.to}   ${describeMessage(m)}`,
		);
	});

	const proposal = proposalFrom(world.agents.ivan!, "ben", "prop-1");
	if (!proposal) {
		throw new Error("Ivan has no project idea to pitch");
	}
	console.log("Round 1\n");
	const { world: after, report } = await runRound(world, client, [proposal], {
		onExchange: (exchange) => log.write(exchange),
	});

	for (const { proposal: p, result } of report) {
		console.log(
			`\n  ${p.to}'s private rationale (never sent):\n  ${result.rationale ?? "(none)"}`,
		);
		console.log(
			`  gate blocks: ${result.gateBlocks}${result.fellBack ? " · fell back to a plain decline" : ""}`,
		);
	}

	console.log("\nState after the round:");
	for (const [id, other] of [
		["ivan", "ben"],
		["ben", "ivan"],
	] as const) {
		const c = contactOf(after.agents[id]!, other);
		console.log(
			`  ${id.padEnd(4)}  contact ${other.padEnd(4)} · level ${c.level} · revealed [${c.revealed.join(", ")}] · learned ${JSON.stringify(c.learned)} · history ${c.history.length}`,
		);
	}
	console.log(`\nLLM log: ${log.path}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
