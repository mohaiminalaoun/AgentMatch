// Entry point for `npm run coevolve`: Theo (a workout tracker) proposes to Mara (a rehab coach), the two
// negotiate up to level 2, where either may propose a reshaped version of the project, and then commit.
// Prints every event as it happens, with private rationales, then the original idea next to the one the
// team agreed to build.
import { formatEvent } from "./describe.js";
import { agreedTerms } from "./engine/agent.js";
import { createLlmClient } from "./engine/client.js";
import { runCommitment } from "./engine/commitment.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import type { RunEvent } from "./engine/events.js";
import { createWorld, proposalFrom, runRound } from "./engine/round.js";
import { createRunLog } from "./engine/runlog.js";
import { mara, theo } from "./scenarios.js";

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("coevolve");
	const client = createLlmClient(config);
	const onEvent = (event: RunEvent) => {
		log.write(event);
		const line = formatEvent(event);
		if (line !== undefined) {
			console.log(line);
		}
	};

	const world = createWorld([theo, mara]);
	const proposal = proposalFrom(world.agents.theo!, "mara", "p1");
	if (!proposal) {
		throw new Error("Theo has no project idea to pitch");
	}
	const round = await runRound(world, client, [proposal], { onEvent });
	console.log("\n── commitment ──");
	const { world: after } = await runCommitment(client, round.world, {
		onEvent,
	});

	const agreed = agreedTerms(after.agents.theo!, "mara");
	const team = after.teams[0];
	console.log(`\nOriginal idea:  "${proposal.pitch}"`);
	console.log(
		`Agreed version: ${agreed ? `"${agreed.pitch}" (needs ${agreed.rolesNeeded.join(", ")})` : "none: they never agreed on a version"}`,
	);
	console.log(
		team
			? `Team ${team.members.join(" + ")} builds: "${team.project.description}"${team.project.description === proposal.pitch ? "" : " (reshaped)"}`
			: "No team formed.",
	);
	console.log(`Run log: ${log.path}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
