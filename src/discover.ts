// Entry point for `npm run discover`: the six sample people's agents write their public board listings, then
// each looks at the board and chooses whom to approach. Prints the listings, the board, each agent's choice with its private rationale, and the proposals that
// would be sent. Stops before negotiating; running those conversations together is step 6.2.
import { formatEvent } from "./describe.js";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { buildBoard, discover } from "./engine/discovery.js";
import type { RunEvent } from "./engine/events.js";
import { writeListings } from "./engine/listing.js";
import { createWorld } from "./engine/round.js";
import { createRunLog } from "./engine/runlog.js";
import { ben, ivan, kemi, nia, omar, rosa } from "./scenarios.js";

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("discover");
	const client = createLlmClient(config);
	const print = (event: RunEvent) => {
		log.write(event);
		const line = formatEvent(event);
		if (line !== undefined) {
			console.log(line);
		}
	};

	console.log("Writing board listings:");
	const world = await writeListings(
		client,
		createWorld([ben, ivan, kemi, nia, omar, rosa]),
		{ onEvent: print },
	);

	console.log("\nPublic board (level 0 only):");
	for (const entry of buildBoard(world)) {
		console.log(
			`  ${entry.id.padEnd(5)} ${entry.pitch}  · needs ${entry.rolesNeeded.join(", ")}`,
		);
	}

	console.log("\nChoices:");
	const { proposals } = await discover(client, world, { onEvent: print });

	console.log(`\nProposals after removing duplicates: ${proposals.length}`);
	for (const p of proposals) {
		console.log(`  ${p.from} → ${p.to}   "${p.pitch}"`);
	}
	console.log(`\nRun log: ${log.path}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
