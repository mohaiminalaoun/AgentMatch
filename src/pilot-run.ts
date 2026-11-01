// Entry point for `npm run pilot:run -- <dir> [--fill N --seed S --rounds R --outside ID=AGENT --answer-minutes M]`:
// the whole system on real people,
// one .json file each in <dir> (copy profiles/example.json), plus N generated people so the board isn't too
// thin. Refuses a model the provider trains on. Prints a live status line, then where each real person ended
// up; the full run, private reasoning included, is in the run log, which stays on this machine.
// With --outside, person ID's agent is an outside agent answering through the hosted mailbox as AGENT (its key
// made with `npm run mailbox -- register AGENT`), with M minutes (default 25) to answer each request; everyone
// else thinks with LLM_MODEL. The engine referees it the same way: schema, gate, and safe defaults.
import { formatSummary } from "./describe.js";
import { z } from "zod";
import { createLlmClient, withBrains } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import type { RunEvent } from "./engine/events.js";
import { createMailboxBrain } from "./engine/mailbox-brain.js";
import { createRunLog } from "./engine/runlog.js";
import { summarize } from "./engine/simulation.js";
import { assertRealDataModel } from "./pilot/model.js";
import { loadPeople } from "./pilot/people.js";
import { pilotOutcomes, runPilot } from "./pilot/run.js";
import { createStatus } from "./status.js";

// The value after `--name` on the command line, as a whole number of at least `min`, or `fallback`.
function flag(name: string, fallback: number, min = 1): number {
	const i = process.argv.indexOf(`--${name}`);
	const value = i === -1 ? fallback : Number(process.argv[i + 1]);
	if (!Number.isInteger(value) || value < min) {
		console.error(`--${name} must be a whole number of at least ${min}`);
		process.exit(1);
	}
	return value;
}

const dir = process.argv[2];
if (!dir || dir.startsWith("--")) {
	console.error(
		"Usage: npm run pilot:run -- <dir> [--fill N --seed S --rounds R --outside ID=AGENT --answer-minutes M]",
	);
	process.exit(1);
}
const fill = flag("fill", 0, 0);
const seed = flag("seed", 1);
const maxRounds = flag("rounds", 6);
const answerMinutes = flag("answer-minutes", 25);
// "--outside p-xxxx=muse": whose agent answers through the mailbox, and as which mailbox agent.
const outsideIndex = process.argv.indexOf("--outside");
const outside =
	outsideIndex === -1
		? undefined
		: /^(?<person>p-[a-z0-9]+)=(?<agent>[\w-]+)$/.exec(
				process.argv[outsideIndex + 1] ?? "",
			)?.groups;
if (outsideIndex !== -1 && !outside) {
	console.error(
		"--outside needs a person id and a mailbox agent, like p-4k2m=muse",
	);
	process.exit(1);
}

const MailboxEnv = z.object({
	MAILBOX_URL: z.url(),
	MAILBOX_ENGINE_KEY: z.string().min(16),
});

try {
	readEnvFile();
	const config = loadConfig(process.env);
	assertRealDataModel(config);
	const people = loadPeople(dir);
	const log = createRunLog("pilot");
	const shared = createLlmClient(config);
	let client = shared;
	if (outside) {
		const person = outside.person!;
		if (!people.some((p) => p.profile.id === person)) {
			throw new Error(`--outside: nobody in ${dir} has the id ${person}`);
		}
		const mailbox = MailboxEnv.safeParse(process.env);
		if (!mailbox.success) {
			throw new Error(
				"--outside needs MAILBOX_URL and MAILBOX_ENGINE_KEY in .env",
			);
		}
		client = withBrains(shared, {
			[person]: createMailboxBrain(
				{
					url: mailbox.data.MAILBOX_URL,
					engineKey: mailbox.data.MAILBOX_ENGINE_KEY,
				},
				{ agent: outside.agent!, answerMs: answerMinutes * 60_000 },
			),
		});
	}
	const events: RunEvent[] = [];
	const started = performance.now();
	const status = createStatus(started);

	console.log(
		`${people.length} people from ${dir}${fill > 0 ? ` + ${fill} generated (seed ${seed})` : ""} · up to ${maxRounds} rounds · ${config.model}${config.reasoningEffort ? ` (reasoning: ${config.reasoningEffort})` : ""}${outside ? ` · ${outside.person} answers through the mailbox as ${outside.agent} (${answerMinutes} min per request)` : ""}\n`,
	);
	const world = await runPilot(client, people, {
		fill,
		seed,
		maxRounds,
		onEvent: (event) => {
			events.push(event);
			log.write(event);
			if (event.type === "exchange") {
				status.call(event.usage?.total ?? 0);
			}
		},
		onPhase: (line) => status.print(`▸ ${line}`),
	});
	status.stop();

	console.log(
		"\nWhere each person ended up (names stay hidden from teammates until everyone approves):",
	);
	for (const { id, name, team } of pilotOutcomes(world, people)) {
		console.log(
			team
				? `  ${name} (${id}): team with ${team.members.filter((m) => m !== id).join(", ")} · “${team.project}”`
				: `  ${name} (${id}): no team`,
		);
	}
	const seconds = ((performance.now() - started) / 1000).toFixed(0);
	console.log(`\n${formatSummary(summarize(world, events), config.prices)}`);
	console.log(
		`Time: ${seconds}s · run log: ${log.path} (holds everyone's private reasoning; keep it on this machine)`,
	);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
