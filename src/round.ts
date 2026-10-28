// Entry point for `npm run round`: one live round on the bus. Ivan proposes his project to Ben, Ben's agent
// decides, and the reply comes back. Every event is printed as it happens, then both agents' state.
import { formatEvent } from "./describe.js";
import { contactOf } from "./engine/agent.js";
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

	const proposal = proposalFrom(world.agents.ivan!, "ben", "prop-1");
	if (!proposal) {
		throw new Error("Ivan has no project idea to pitch");
	}
	const { world: after } = await runRound(world, client, [proposal], {
		onEvent: (event) => {
			log.write(event);
			const line = formatEvent(event);
			if (line !== undefined) {
				console.log(line);
			}
		},
	});

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
	console.log(`\nRun log: ${log.path}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
