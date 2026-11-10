// A made-up `repair` request for an outside agent, built the way the arena builds a real one (the engine's own
// repair prompt and the mailbox preface), plus a check of a reply against the same rules the arena applies
// (`repairProblems`), so one can see whether an outside agent's repair would be accepted without running a whole
// pilot to reach one. The owner, the team, and the missing role are made up: a design role is still needed, and a
// smaller build without it is the way out.
import { z } from "zod";
import { createAgent, learn, raiseLevel } from "../engine/agent.js";
import { createBus } from "../engine/bus.js";
import { stillNeeded } from "../engine/commitment.js";
import { promptText } from "../engine/mailbox-brain.js";
import type { Profile } from "../engine/profile.js";
import {
	RepairProposal,
	repairMessages,
	repairProblems,
} from "../engine/repair.js";
import type { World } from "../engine/round.js";
import type { Team } from "../engine/team.js";

const MEMBER = "p-sample-member";

function setup(agent: string) {
	const ownerProfile: Profile = {
		id: `p-sample-${agent}`,
		name: "Sample Owner",
		skills: [{ name: "backend", level: "intermediate" }],
		interests: ["health"],
		projectIdeas: [
			{
				title: "Habit Nudge",
				description:
					"A reminder service that helps people keep small health habits.",
			},
		],
		availability: { hoursPerWeek: 12, utcOffset: -5 },
		preferences: {
			minTeamSize: 2,
			maxTeamSize: 4,
			preferredRoles: ["backend"],
		},
	};
	const memberProfile: Profile = {
		...ownerProfile,
		id: MEMBER,
		name: "Sample Member",
		skills: [{ name: "devops", level: "expert" }],
	};
	const team: Team = {
		id: `team-${ownerProfile.id}`,
		members: [ownerProfile.id, MEMBER],
		project: {
			title: "Habit Nudge",
			description:
				"A reminder service with an animated companion that adapts its tone to each user.",
		},
		rolesNeeded: ["devops", "design"],
		problem: "People forget small health habits without a gentle nudge.",
		build: "A web service with scheduled reminders and an animated companion screen.",
		roleWork: {
			devops: "deploy the reminder service and its scheduler",
			design: "design the animated companion and its reminder screens",
		},
		status: "tentative",
	};
	// The owner knows what the member shared at level 2: their skills.
	const owner = raiseLevel(
		learn(createAgent(ownerProfile), MEMBER, {
			skills: memberProfile.skills,
		}),
		MEMBER,
		2,
	);
	const world: World = {
		agents: {
			[ownerProfile.id]: owner,
			[MEMBER]: createAgent(memberProfile),
		},
		bus: createBus([ownerProfile.id, MEMBER]),
		teams: [team],
	};
	return { owner, team, world };
}

export function repairSampleRequest(agent: string, now = Date.now()) {
	const { owner, team, world } = setup(agent);
	const needed = stillNeeded(world, owner.id);
	return {
		id: `seed-${agent}-repair-${now.toString(36)}`,
		agent,
		kind: "repair",
		level: 2,
		deadline: new Date(now + 3 * 60 * 60_000).toISOString(),
		replySchema: z.toJSONSchema(RepairProposal, {
			io: "input",
			unrepresentable: "any",
		}) as Record<string, unknown>,
		prompt: promptText(repairMessages(owner, team, needed)),
	};
}

// What the arena would say about `reply`: schema problems, then the repair rules. Empty means accepted.
export function repairSampleProblems(agent: string, reply: unknown): string[] {
	const parsed = RepairProposal.safeParse(reply);
	if (!parsed.success) {
		return parsed.error.issues.map(
			(i) => `${i.path.join(".")}: ${i.message}`,
		);
	}
	const { team, world } = setup(agent);
	return repairProblems(world, team, parsed.data);
}
