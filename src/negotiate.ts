// Entry point for `npm run negotiate`: Nia proposes to Kemi and the two negotiate over the bus, tick by tick,
// printing every message, both sides' level after each tick, and what each has learned about the other.
import { contactOf } from "./engine/agent.js";
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { createWorld, proposalFrom, runRound } from "./engine/round.js";
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
		const what =
			"kind" in m
				? `share (level ${m.level}): ${JSON.stringify(m.shared)}`
				: "decision" in m
					? `${m.decision}${"pitch" in m ? `: "${m.pitch}"` : ""}`
					: `proposal: "${m.pitch}"`;
		console.log(`  ${m.from} → ${m.to}   ${what}`);
	});

	const proposal = proposalFrom(world.agents.nia!, "kemi", "prop-1");
	if (!proposal) {
		throw new Error("Nia has no project idea to pitch");
	}
	console.log("Sending Nia's proposal\n");
	const {
		world: after,
		report,
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
			`  ${p.to} on ${p.id}: ${result.decision.decision}. ${result.rationale ?? "(none)"}`,
		);
	}
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
