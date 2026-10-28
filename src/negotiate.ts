// Entry point for `npm run negotiate`: Nia proposes to Kemi and the two negotiate over the bus up to level 2.
// Every event is printed as it happens, exactly as `npm run show-run` will print it from the log afterwards,
// followed by the final levels and what each side learned.
import { formatEvent } from "./describe.js";
import { contactOf } from "./engine/agent.js";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import {
	continued,
	createWorld,
	proposalFrom,
	runRound,
} from "./engine/round.js";
import { createRunLog } from "./engine/runlog.js";
import { kemi, nia } from "./scenarios.js";

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("negotiate");
	const client = createLlmClient(config);
	const world = createWorld([nia, kemi]);

	const proposal = proposalFrom(world.agents.nia!, "kemi", "prop-1");
	if (!proposal) {
		throw new Error("Nia has no project idea to pitch");
	}
	const { world: after, quiet } = await runRound(world, client, [proposal], {
		onEvent: (event) => {
			log.write(event);
			const line = formatEvent(event);
			if (line !== undefined) {
				console.log(line);
			}
		},
	});

	const n = after.agents.nia!;
	const k = after.agents.kemi!;
	const ready =
		continued(n, "nia", "kemi", 2) && continued(n, "kemi", "nia", 2);
	console.log(
		`\nFinal levels: nia ${contactOf(n, "kemi").level}, kemi ${contactOf(k, "nia").level}${ready ? " · both continued at level 2: ready to commit (step 6.3)" : ""}`,
	);
	console.log("\nWhat each side learned:");
	console.log(
		`  nia about kemi: ${JSON.stringify(contactOf(n, "kemi").learned)}`,
	);
	console.log(
		`  kemi about nia: ${JSON.stringify(contactOf(k, "nia").learned)}`,
	);
	console.log(
		`\n${quiet ? "Conversation finished." : "Stopped at the tick limit."} Run log: ${log.path}`,
	);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
