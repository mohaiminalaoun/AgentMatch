// Entry point for `npm run simulate [-- --agents N --rounds R --seed S --private --brain-model M --cast]`: the whole system on
// generated people, for up to R rounds (default 6), stopping sooner once a round changes nothing. Agents write listings, then each round pick whom to approach and negotiate, all at once.
// Prints every event as it happens (with private rationales only under --private), a live status line while
// model calls are out, and a report at the end; the full timeline is in the run log (`npm run show-run`).
// With --brain-model, the first agent thinks with model M on the same provider instead, while everyone else
// uses LLM_MODEL: the engine referees it exactly the same way. With --cast, the people are the first N of the
// fixed cast built from real hackathon ideas instead of generated ones, and each team is judged against the
// cast's expected groups.
import { formatEvent, formatSummary } from "./describe.js";
import { createLlmClient, withBrains } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import type { RunEvent } from "./engine/events.js";
import { createRunLog } from "./engine/runlog.js";
import { runSimulation, summarize } from "./engine/simulation.js";
import { measureLeakage } from "./evaluation/leakage.js";
import { castProfiles, judgeTeam } from "./evaluation/cast.js";
import { generateProfiles } from "./evaluation/profiles.js";
import { createStatus } from "./status.js";

// The value after `--name` on the command line, as a whole number, or `fallback`.
function flag(name: string, fallback: number): number {
	const i = process.argv.indexOf(`--${name}`);
	const value = i === -1 ? fallback : Number(process.argv[i + 1]);
	if (!Number.isInteger(value) || value < 1) {
		console.error(`--${name} must be a whole number of at least 1`);
		process.exit(1);
	}
	return value;
}

const agents = flag("agents", 10);
// The most rounds; the run stops sooner once a round changes nothing.
const maxRounds = flag("rounds", 6);
const seed = flag("seed", 1);
const showPrivate = process.argv.includes("--private");
const useCast = process.argv.includes("--cast");
// Another model for the first agent, to try an agent with a brain of its own.
const brainIndex = process.argv.indexOf("--brain-model");
const brainModel = brainIndex === -1 ? undefined : process.argv[brainIndex + 1];
if (brainIndex !== -1 && (!brainModel || brainModel.startsWith("--"))) {
	console.error("--brain-model needs a model id, like muse-wonder-1.0");
	process.exit(1);
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("simulate");
	const profiles = useCast
		? castProfiles(agents)
		: generateProfiles(agents, seed);
	const brainAgent = profiles[0]!.id;
	const shared = createLlmClient(config);
	const client = brainModel
		? withBrains(shared, {
				[brainAgent]: createLlmClient({ ...config, model: brainModel }),
			})
		: shared;
	const events: RunEvent[] = [];
	const started = performance.now();
	const status = createStatus(started);

	console.log(
		`${agents} agents · up to ${maxRounds} rounds · seed ${seed} · ${config.model}${config.reasoningEffort ? ` (reasoning: ${config.reasoningEffort})` : ""}${brainModel ? ` · ${brainAgent} thinks with ${brainModel}` : ""}\n`,
	);
	const world = await runSimulation(client, profiles, {
		maxRounds,
		onEvent: (event) => {
			events.push(event);
			log.write(event);
			if (event.type === "exchange") {
				status.call(event.usage?.total ?? 0);
			}
			const line = formatEvent(event, { rationale: showPrivate });
			if (line !== undefined) {
				status.print(line);
			}
		},
		onPhase: (line) => status.print(`\n▸ ${line}`),
	});
	status.stop();

	const seconds = ((performance.now() - started) / 1000).toFixed(0);
	console.log(`\n${formatSummary(summarize(world, events), config.prices)}`);
	const leakage = measureLeakage(world);
	console.log(
		`Leakage:  ${(leakage.rate * 100).toFixed(1)}% of private fields reached someone outside the sender's team (${Object.entries(
			leakage.byField,
		)
			.map(([field, n]) => `${field} ${n}`)
			.join(", ")})`,
	);
	if (useCast) {
		console.log("Against the cast's expected groups:");
		for (const team of world.teams) {
			const { verdict, clusters } = judgeTeam(team.members);
			console.log(
				`  ${team.members.join(" + ")}: ${verdict} (${clusters.join(", ")})`,
			);
		}
	}
	if (brainModel) {
		const byModel: Record<string, number> = {};
		for (const e of events) {
			if (e.type === "exchange" && e.model) {
				byModel[e.model] = (byModel[e.model] ?? 0) + 1;
			}
		}
		const team = world.teams.find((t) => t.members.includes(brainAgent));
		console.log(
			`Brains:   ${Object.entries(byModel)
				.map(([model, n]) => `${model} ${n} calls`)
				.join(
					", ",
				)} (cost above assumes LLM_MODEL's prices) · ${brainAgent} ${team ? `ended on a ${team.status} team of ${team.members.length}` : "ended on no team"}`,
		);
	}
	console.log(
		`Time: ${seconds}s · run log: ${log.path} (npm run show-run for the full timeline)`,
	);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
