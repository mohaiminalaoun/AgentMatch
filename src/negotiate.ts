// Entry point for `npm run negotiate`: Nia proposes to Kemi and the two negotiate over the bus, tick by tick,
// up to level 2: every message, both sides' level after each tick, every private rationale (decisions and
// interest checks), and what each has learned about the other.
import { contactOf } from "./engine/agent.js";
import { describeMessage } from "./describe.js";
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

	world.bus.subscribe((event) => {
		if (event.type === "rejected") {
			console.log(`  ✗ bus rejected: ${event.reason}`);
			return;
		}
		const m = event.message;
		console.log(`  ${m.from} → ${m.to}   ${describeMessage(m)}`);
	});

	const proposal = proposalFrom(world.agents.nia!, "kemi", "prop-1");
	if (!proposal) {
		throw new Error("Nia has no project idea to pitch");
	}
	console.log("Sending Nia's proposal\n");
	const {
		world: after,
		report,
		interests,
		quiet,
	} = await runRound(world, client, [proposal], {
		onExchange: (exchange) => log.write(exchange),
		onTick: (tick, now) => {
			const n = contactOf(now.agents.nia!, "kemi").level;
			const k = contactOf(now.agents.kemi!, "nia").level;
			console.log(
				`  ── after tick ${tick}: nia at level ${n}, kemi at level ${k}\n`,
			);
		},
	});

	console.log("Private rationales (each for its own human only):");
	for (const { proposal: p, result } of report) {
		console.log(
			`  ${p.to} on ${p.id}: ${result.decision.decision}${result.gateBlocks > 0 ? ` (gate blocked ${result.gateBlocks})` : ""}. ${result.rationale ?? "(none)"}`,
		);
	}
	for (const { agent, otherId, level, result } of interests) {
		console.log(
			`  ${agent} at level ${level} with ${otherId}: ${result.interest}. ${result.rationale ?? "(none)"}`,
		);
	}

	const n = after.agents.nia!;
	const k = after.agents.kemi!;
	const ready =
		continued(n, "nia", "kemi", 2) && continued(n, "kemi", "nia", 2);
	console.log(
		`\nFinal levels: nia ${contactOf(n, "kemi").level}, kemi ${contactOf(k, "nia").level}${ready ? " · both continued at level 2: ready to commit (step 6.3)" : ""}`,
	);
	console.log("\nWhat each side learned:");
	console.log(
		`  nia about kemi: ${JSON.stringify(contactOf(after.agents.nia!, "kemi").learned)}`,
	);
	console.log(
		`  kemi about nia: ${JSON.stringify(contactOf(after.agents.kemi!, "nia").learned)}`,
	);
	console.log(
		`\n${quiet ? "Conversation finished." : "Stopped at the tick limit."} LLM log: ${log.path}`,
	);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
