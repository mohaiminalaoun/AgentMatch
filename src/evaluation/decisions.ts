// Hard problems in the decisions a run made, found by code alone: final teams bigger or smaller than a
// member's limits, roles a team's project needs that no member has the skill for (or only a beginner has), and
// offers where the code sent a different set than the owner's model chose (the case where a rationale
// describes a team that never forms). No model calls. These are separate from whether explanations are
// grounded (explain.ts): an agent can explain a bad choice perfectly.
import type { RunEvent } from "../engine/events.js";
import { Profile } from "../engine/profile.js";
import type { Team } from "../engine/team.js";
import { callOf } from "./explain.js";

// Each agent's own profile, read from the system prompts in a log's model calls (every prompt includes the
// human's full profile). Logs without model calls yield none.
export function profilesFrom(
	events: readonly RunEvent[],
): Map<string, Profile> {
	const profiles = new Map<string, Profile>();
	for (const event of events) {
		if (event.type !== "exchange") {
			continue;
		}
		for (const message of event.messages) {
			const json = message.content.match(
				/Your human's full profile[^:\n]*:\n(\{[\s\S]*?\n\})/,
			)?.[1];
			if (!json) {
				continue;
			}
			try {
				const parsed = Profile.safeParse(JSON.parse(json));
				if (parsed.success && !profiles.has(parsed.data.id)) {
					profiles.set(parsed.data.id, parsed.data);
				}
			} catch {
				// Not a whole profile; skip it.
			}
		}
	}
	return profiles;
}

export type DecisionFinding =
	| {
			kind: "team too big";
			team: string;
			size: number;
			member: string;
			max: number;
	  }
	| {
			kind: "team too small";
			team: string;
			size: number;
			member: string;
			min: number;
	  }
	| { kind: "role nobody can do"; team: string; role: string }
	| {
			kind: "role only a beginner can do";
			team: string;
			role: string;
			members: string[];
	  }
	| {
			kind: "offers differ from the model's choice";
			owner: string;
			chose: string[];
			sent: string[];
	  };

export type DecisionReport = {
	teams: number;
	placed: number;
	people: number;
	// Calls where no valid reply came back and the code fell back to a safe default.
	fellBack: number;
	findings: DecisionFinding[];
	// How many agents' profiles were found; checks that need a profile skip anyone missing.
	profiles: number;
};

// Checks the final teams and every set of offers in `events`.
export function checkDecisions(events: readonly RunEvent[]): DecisionReport {
	const profiles = profilesFrom(events);
	const teams = new Map<string, Team>();
	const people = new Set<string>();
	let fellBack = 0;
	const findings: DecisionFinding[] = [];
	// The owner's model's last offers choice, waiting for the offers event that reports what was sent.
	const chosen = new Map<string, string[]>();
	for (const event of events) {
		if (event.type === "round") {
			event.agents.forEach((id) => people.add(id));
		}
		if (event.type === "team") {
			teams.set(event.team.id, event.team);
		}
		if ("fellBack" in event && event.fellBack) {
			fellBack++;
		}
		if (event.type === "exchange") {
			const { kind, agent } = callOf(event);
			if (kind === "offers" && agent) {
				try {
					const reply = JSON.parse(event.reply) as {
						offer?: unknown;
					};
					if (Array.isArray(reply.offer)) {
						chosen.set(agent, reply.offer.map(String));
					}
				} catch {
					// An invalid reply is retried; the valid one follows.
				}
			}
		}
		if (event.type === "offers") {
			const choice = chosen.get(event.agent);
			chosen.delete(event.agent);
			if (choice && !sameSet(choice, event.to)) {
				findings.push({
					kind: "offers differ from the model's choice",
					owner: event.agent,
					chose: choice,
					sent: event.to,
				});
			}
		}
	}

	for (const team of teams.values()) {
		const size = team.members.length;
		for (const id of team.members) {
			const prefs = profiles.get(id)?.preferences;
			if (prefs && size > prefs.maxTeamSize) {
				findings.push({
					kind: "team too big",
					team: team.id,
					size,
					member: id,
					max: prefs.maxTeamSize,
				});
			}
			if (prefs && size < prefs.minTeamSize) {
				findings.push({
					kind: "team too small",
					team: team.id,
					size,
					member: id,
					min: prefs.minTeamSize,
				});
			}
		}
		const known = team.members.every((id) => profiles.has(id));
		for (const role of known ? team.rolesNeeded : []) {
			if (role === "any") {
				continue;
			}
			const levels = team.members.flatMap((id) =>
				profiles
					.get(id)!
					.skills.filter((s) => s.name === role)
					.map((s) => ({ id, level: s.level })),
			);
			if (levels.length === 0) {
				findings.push({
					kind: "role nobody can do",
					team: team.id,
					role,
				});
			} else if (levels.every((l) => l.level === "beginner")) {
				findings.push({
					kind: "role only a beginner can do",
					team: team.id,
					role,
					members: levels.map((l) => l.id),
				});
			}
		}
	}

	return {
		teams: teams.size,
		placed: new Set([...teams.values()].flatMap((t) => t.members)).size,
		people: people.size,
		fellBack,
		findings,
		profiles: profiles.size,
	};
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((x) => b.includes(x));
}

// One line per finding, readable on its own.
export function describeFinding(f: DecisionFinding): string {
	switch (f.kind) {
		case "team too big":
			return `${f.team} has ${f.size} people; ${f.member} wants at most ${f.max}`;
		case "team too small":
			return `${f.team} has ${f.size} people; ${f.member} wants at least ${f.min}`;
		case "role nobody can do":
			return `${f.team}'s project needs ${f.role}, and no member has that skill`;
		case "role only a beginner can do":
			return `${f.team}'s project needs ${f.role}, and only ${f.members.join(", ")} (beginner) has it`;
		case "offers differ from the model's choice":
			return `${f.owner}'s model chose ${f.chose.join(", ") || "nobody"}, but offers went to ${f.sent.join(", ") || "nobody"}`;
	}
}
