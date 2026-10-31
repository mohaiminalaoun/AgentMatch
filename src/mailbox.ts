// Entry point for `npm run mailbox -- <command>`: the engine's side of the hosted mailbox (step 11.13), for
// trying an outside agent by hand before the engine uses the mailbox itself.
//   register <agent>   make a key for an outside agent (shown once; replaces any key it had)
//   seed <agent> [sample]  leave it a sample proposal to decide on, due in 3 hours (samples: recorder,
//                      the default; bjj, close to a project of its own; pets, a poor fit)
//   answers <id...>    show the answers that came back for these requests
// Reads MAILBOX_URL and MAILBOX_ENGINE_KEY from .env. Never prints the engine key.
import { z } from "zod";
import { readEnvFile } from "./engine/config.js";
import { AgentDecision } from "./engine/decision.js";

const Env = z.object({
	MAILBOX_URL: z.url({ error: "must be the mailbox's https URL" }),
	MAILBOX_ENGINE_KEY: z.string().min(16, { error: "is missing or short" }),
});

// Sample proposals at level 0, from a made-up agent.
const SAMPLES = {
	recorder: {
		from: "p-test",
		title: "Agent flight recorder",
		pitch: "Identity, scoped permissions, and audit trails for AI agents doing real jobs, proven with evals.",
		rolesNeeded: ["frontend", "backend"],
	},
	bjj: {
		from: "p-mat",
		title: "Gym hub for jiu-jitsu academies",
		pitch: "One app for a BJJ academy: class schedules, check-ins, belt progress, and booking private lessons.",
		rolesNeeded: ["frontend", "backend"],
	},
	pets: {
		from: "p-paws",
		title: "Pawfect filters",
		pitch: "Instagram-style photo filters made for pets, with breed-aware stickers and a share-to-story button.",
		rolesNeeded: ["design", "mobile"],
	},
} as const;
type Sample = keyof typeof SAMPLES;

// A sample request, written for an outside agent, which already knows its human, so unlike a hosted agent's
// prompt it carries no profile.
function sampleRequest(agent: string, sample: Sample) {
	const { from, title, pitch, rolesNeeded } = SAMPLES[sample];
	const id = `seed-${agent}-${sample}-${Date.now().toString(36)}`;
	return {
		id,
		agent,
		kind: "decision",
		level: 0,
		deadline: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
		replySchema: z.toJSONSchema(AgentDecision),
		prompt: [
			"You are a personal agent in Agent Match, an arena where agents negotiate hackathon teams for their humans. You act for your human, using what you know about them.",
			"",
			`Agent ${from} proposes a project to you. This is level 0: you know only their public listing, and they know only yours.`,
			`Title: "${title}"`,
			`Pitch: "${pitch}"`,
			`Roles they need from others: ${rolesNeeded.join(", ")}`,
			"",
			"Decide for your human: accept (move to level 1, where you each share interests and availability), counter with your own version (title, pitch, rolesNeeded), or decline.",
			"Reply with a JSON object matching replySchema. \"rationale\" is private: it goes only to the arena operator's log, never to the other agent. Put nothing about your human in a counter that this level doesn't allow: at level 0 that is only the project itself.",
		].join("\n"),
	};
}

async function call(
	env: z.infer<typeof Env>,
	path: string,
	body: unknown,
): Promise<unknown> {
	const response = await fetch(new URL(path, env.MAILBOX_URL), {
		method: "POST",
		headers: {
			authorization: `Bearer ${env.MAILBOX_ENGINE_KEY}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
	});
	const data: unknown = await response.json().catch(() => undefined);
	if (!response.ok) {
		throw new Error(
			`${path} answered ${response.status}: ${JSON.stringify(data)}`,
		);
	}
	return data;
}

const [command, ...args] = process.argv.slice(2);
try {
	readEnvFile();
	const parsed = Env.safeParse(process.env);
	if (!parsed.success) {
		throw new Error(
			`Mailbox settings are invalid:\n${parsed.error.issues.map((i) => `- ${String(i.path[0])} ${i.message}`).join("\n")}`,
		);
	}
	const env = parsed.data;
	if (command === "register" && args[0]) {
		const { key } = (await call(env, "/engine/agents", {
			agent: args[0],
		})) as { key: string };
		console.log(
			`Key for ${args[0]} (shown once; give it to the agent's connector setup, never paste it in a chat):\n${key}`,
		);
	} else if (command === "seed" && args[0]) {
		const sample = args[1] ?? "recorder";
		if (!(sample in SAMPLES)) {
			throw new Error(
				`No sample "${sample}"; try ${Object.keys(SAMPLES).join(", ")}.`,
			);
		}
		const request = sampleRequest(args[0], sample as Sample);
		await call(env, "/engine/requests", { requests: [request] });
		console.log(
			`Left request ${request.id} for ${args[0]}, due ${request.deadline}.\nCheck with: npm run mailbox -- answers ${request.id}`,
		);
	} else if (command === "answers" && args.length > 0) {
		const { answers } = (await call(env, "/engine/answers", {
			ids: args,
		})) as { answers: Record<string, { reply: unknown; at: string }> };
		for (const id of args) {
			const answer = answers[id];
			if (!answer) {
				console.log(`${id}: no answer yet`);
				continue;
			}
			const valid = AgentDecision.safeParse(answer.reply);
			console.log(
				`${id}: answered ${answer.at} · ${valid.success ? "valid" : `invalid: ${valid.error.issues.map((i) => i.message).join("; ")}`}\n${JSON.stringify(answer.reply, null, 2)}`,
			);
		}
	} else {
		console.error(
			"Usage: npm run mailbox -- register <agent> | seed <agent> [recorder|bjj|pets] | answers <id...>",
		);
		process.exit(1);
	}
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
