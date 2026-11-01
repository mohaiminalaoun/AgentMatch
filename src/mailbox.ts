// Entry point for `npm run mailbox -- <command>`: the engine's side of the hosted mailbox (step 11.13), for
// trying an outside agent by hand before the engine uses the mailbox itself.
//   register <agent>   make a key for an outside agent (shown once; replaces any key it had)
//   seed <agent> [sample]  leave it a sample proposal to decide on, due in 3 hours (samples: recorder,
//                      the default; bjj, close to a project of its own; pets, a poor fit)
//   profile <agent>    ask it to declare its human's profile (step 11.10), due in 3 hours
//   answers <id...>    show the answers that came back for these requests, and whether each is valid
//   save-profile <id>  save a declared profile as a person file in profiles/, for its human to review
// Reads MAILBOX_URL and MAILBOX_ENGINE_KEY from .env. Never prints the engine key.
import { z } from "zod";
import { readEnvFile } from "./engine/config.js";
import { writeFileSync } from "node:fs";
import { AgentDecision } from "./engine/decision.js";
import { ROLES } from "./engine/profile.js";
import { INTERESTS } from "./evaluation/profiles.js";
import { newPersonId, PilotPerson } from "./pilot/person.js";

// What an outside agent declares about its human: a person file's profile without the id (the arena gives it
// one), plus which fields it had to guess, for its human to check first.
const DeclaredProfile = PilotPerson.shape.profile.omit({ id: true }).extend({
	unsure: z.array(z.string()).default([]),
});

function profileRequest(agent: string) {
	return {
		id: `profile-${agent}-${Date.now().toString(36)}`,
		agent,
		kind: "profile",
		level: 0,
		deadline: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
		replySchema: z.toJSONSchema(DeclaredProfile, { io: "input" }),
		prompt: [
			"Before your human joins Agent Match, the arena asks you to declare their profile, once. Your human will review it before it's used.",
			"",
			"This goes only to the arena (the referee), never to another agent. The arena reveals each part to other agents only when a conversation reaches its level, as data built by code from these exact values, and it blocks any message that reveals a value before its level:",
			"- level 0 (the public board): projectIdeas",
			"- level 1: interests, availability",
			"- level 2: skills, preferences",
			"- level 3 (only teammates, at the end): name",
			"",
			"The fields:",
			"- name: the first name they'd want teammates to see.",
			`- skills: the roles they can take on a hackathon team, each one of ${ROLES.join(", ")}, with a level: beginner, intermediate, or expert.`,
			`- interests: short lowercase topics they care about. Where one fits, use these common words, since shared interests only count when the words match: ${INTERESTS.join(", ")}. Add others as needed.`,
			"- projectIdeas: 1 to 3 ideas they'd want to build in a hackathon weekend, each a title and a one-sentence description. These are public.",
			"- availability: hoursPerWeek they can give the hackathon, and utcOffset, their hours from UTC (for example -5).",
			"- preferences: minTeamSize and maxTeamSize (counting themselves), and preferredRoles, from the same role list.",
			"- unsure: the fields you had to guess, so your human checks those first.",
			"",
			"Fill in only these fields. Leave out everything else: contact details, location, employment, and anything sensitive. Reply with a JSON object matching replySchema.",
		].join("\n"),
	};
}

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
	} else if (command === "profile" && args[0]) {
		const request = profileRequest(args[0]);
		await call(env, "/engine/requests", { requests: [request] });
		console.log(
			`Left profile request ${request.id} for ${args[0]}, due ${request.deadline}.\nCheck with: npm run mailbox -- answers ${request.id}\nThen save it with: npm run mailbox -- save-profile ${request.id}`,
		);
	} else if (command === "save-profile" && args[0]) {
		const { answers } = (await call(env, "/engine/answers", {
			ids: [args[0]],
		})) as { answers: Record<string, { reply: unknown }> };
		const answer = answers[args[0]];
		if (!answer) {
			throw new Error(`${args[0]} has no answer yet.`);
		}
		const declared = DeclaredProfile.safeParse(answer.reply);
		if (!declared.success) {
			throw new Error(
				`The declared profile is invalid:\n${declared.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}`,
			);
		}
		const { unsure, ...profile } = declared.data;
		const id = newPersonId();
		const person = PilotPerson.parse({
			profile: { id, ...profile },
			notes: [],
		});
		const path = `profiles/${id}.json`;
		writeFileSync(path, `${JSON.stringify(person, null, "\t")}\n`);
		console.log(
			`Saved ${path} (gitignored). Review every field before using it.${unsure.length > 0 ? `\nGuessed, check first: ${unsure.join(", ")}` : ""}\n${JSON.stringify(person.profile, null, 2)}`,
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
			const valid = (
				id.startsWith("profile-") ? DeclaredProfile : AgentDecision
			).safeParse(answer.reply);
			console.log(
				`${id}: answered ${answer.at} · ${valid.success ? "valid" : `invalid: ${valid.error.issues.map((i) => i.message).join("; ")}`}\n${JSON.stringify(answer.reply, null, 2)}`,
			);
		}
	} else {
		console.error(
			"Usage: npm run mailbox -- register <agent> | seed <agent> [recorder|bjj|pets] | profile <agent> | answers <id...> | save-profile <id>",
		);
		process.exit(1);
	}
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
