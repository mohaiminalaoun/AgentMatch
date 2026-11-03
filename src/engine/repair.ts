// One scope-repair opportunity per incomplete tentative team before final confirmation.
// No new recruits, roster changes, or automatic role retirement; every member must approve.
import { z } from "zod";
import { contactOf, type AgentState } from "./agent.js";
import { brainOf, type LlmClient } from "./client.js";
import { assignTeamRoles, stillNeeded, teamTerms } from "./commitment.js";
import { exchangeEvent, type RunEvent } from "./events.js";
import { factsText, fitFacts } from "./fit.js";
import { checkDisclosure, checkThirdParty, draftOf } from "./gate.js";
import { CITE_FACTS, FINAL_TEAM, GOOD_TEAM, OWNER_WORK } from "./goals.js";
import { StructuredOutputError, type Message } from "./llm.js";
import { confirmationProblems } from "./lock.js";
import { aboutHuman, guidance } from "./notes.js";
import {
	containsPersonalClaim,
	undisclosedProjectText,
} from "./project-context.js";
import { ROLES } from "./profile.js";
import { Terms, termsTexts } from "./proposal.js";
import type { World } from "./round.js";
import type { Team } from "./team.js";

const Revision = Terms.extend({
	title: z.string().min(1).max(60),
	problem: z.string().min(1).max(200),
	build: z.string().min(1).max(200),
	rolesNeeded: z.array(z.enum(ROLES)).min(1),
	roleWork: z.record(z.string(), z.string().min(1).max(160)),
});
export const RepairProposal = z.object({
	rationale: z.string().min(1),
	revision: Revision.optional(),
	removedWork: z
		.array(
			z.object({
				role: z.enum(ROLES),
				change: z.string().min(1).max(200),
			}),
		)
		.default([]),
});
export type RepairProposal = z.infer<typeof RepairProposal>;
export const RepairVote = z
	.object({
		rationale: z.string().min(1),
		cardConsistent: z.boolean(),
		approve: z.boolean(),
	})
	.refine((vote) => !vote.approve || vote.cardConsistent, {
		message:
			"An inconsistent project card cannot be approved. Correct the card in a future proposal; vote approve false here.",
	});

export const SCOPE_CONSISTENCY =
	"Check the proposed title, pitch, problem, build, roleWork and removedWork together. Set cardConsistent false if any field promises functionality that another field explicitly removes or replaces: for example a pitch offering image uploads while removedWork says bundled images only, or live adaptive reporters after replacing them with fixed prompts. A bundled/local demo is valid when all fields describe it honestly. Role removal alone is not a contradiction if the work remains with the owner. Do not reject just because a demo is smaller than the full user problem. When inconsistent, quote the conflicting project phrases in your private rationale and vote approve false. This is a semantic judgment, not a keyword test.";

function privateContext(agent: AgentState, team: Team): string[] {
	return [
		aboutHuman(agent, 2),
		...(guidance(agent) ? [guidance(agent)] : []),
		GOOD_TEAM,
		OWNER_WORK,
		...team.members
			.filter((id) => id !== agent.id && contactOf(agent, id).level >= 2)
			.map((id) => factsText(fitFacts(agent, id))),
		"Other members' unshared facts remain unknown. Do not infer their skills from team membership.",
	];
}

export function repairMessages(
	owner: AgentState,
	team: Team,
	needed: readonly string[],
): Message[] {
	return [
		{
			role: "system",
			content: [
				"You are the project's owner agent. Recruitment has ended, but there is one bounded opportunity to repair an incomplete team's scope before final confirmation.",
				...privateContext(owner, team),
				"Propose a smaller version that preserves the original user problem and a credible contribution for every existing member. Use only known skills. No new roles, recruits, roster changes, or changes to anyone's team-size requirements are possible here.",
				"For every removed role, removedWork must describe the concrete work removed or simplified and how the demo changes. Do not merely rename a role or declare essential work optional. Every remaining teammate role must have known coverage on the current roster. Keep rolesNeeded for teammates' work, not work the owner already takes.",
				"Update every affected project field together. The pitch must describe the reduced demo honestly: do not retain promises such as uploads, accounts, live interaction or adaptive feedback after removing them. The revision includes title, pitch, problem, build, rolesNeeded, and roleWork for exactly those roles. If no credible smaller build exists, omit revision and leave removedWork empty. A proposal is not applied unless every member approves it.",
				"The revision and removedWork are sent to the whole team: describe only the project, never personal facts or information learned from another member. Keep the proposal safe to show publicly; use your private knowledge only for judgment. Your rationale stays private.",
				CITE_FACTS,
			].join("\n\n"),
		},
		{
			role: "user",
			content: `Repair this group: ${JSON.stringify({ project: teamTerms(team), size: team.members.length, rolesStillNeeded: needed })}`,
		},
	];
}

export function repairVoteMessages(
	agent: AgentState,
	team: Team,
	proposal: RepairProposal,
): Message[] {
	return [
		{
			role: "system",
			content: [
				"You are deciding whether to adopt one pre-deadline scope repair. Apply the same personal-fit standard as final confirmation. You will still be free to withdraw afterward; approval does not bind your human.",
				...privateContext(agent, team),
				FINAL_TEAM,
				SCOPE_CONSISTENCY,
				"Approve only if the smaller build still solves a worthwhile version of the original problem, the removedWork genuinely removes its dependencies, and your human retains a credible contribution consistent with their requirements. Evaluate interest in this exact project, standing instructions, concrete contribution, hours, and current team size now. Do not approve a technically feasible repair that your human would already reject at final confirmation. A different role label alone is not a repair. Unknown coverage is unverified. Declining keeps the original project; it does not remove you from the roster. Return cardConsistent and approve; your rationale is private.",
				CITE_FACTS,
			].join("\n\n"),
		},
		{
			role: "user",
			content: `Approve scope repair: ${JSON.stringify({ current: teamTerms(team), projectOwnerIsYourHuman: team.members[0] === agent.id, proposed: proposal.revision, removedWork: proposal.removedWork, size: team.members.length })}`,
		},
	];
}

// Validate project text without authorizing any new disclosure between team members.
export function repairProblems(
	world: World,
	team: Team,
	proposal: RepairProposal,
): string[] {
	const revision = proposal.revision;
	if (!revision)
		return proposal.removedWork.length
			? ["removedWork requires a revision"]
			: [];
	const owner = world.agents[team.members[0]!]!;
	const removed = team.rolesNeeded.filter(
		(role) =>
			!revision.rolesNeeded.includes(role as (typeof ROLES)[number]),
	);
	const changes = proposal.removedWork.map((change) => change.role);
	const needed = stillNeeded(world, owner.id);
	const covered = new Set(
		team.members
			.slice(1)
			.flatMap(
				(id) =>
					contactOf(owner, id).learned.skills?.map(
						(skill) => skill.name,
					) ?? [],
			),
	);
	const draft = draftOf(revision);
	draft.texts.removedWork = proposal.removedWork
		.map((change) => change.change)
		.join("; ");
	// Only the current agreed team scope is shared by every member. The owner's
	// original listing may contain a different project and is not an exemption here.
	const agreed = Object.values(termsTexts(teamTerms(team)));
	// Exact agreed fields are already public project context, including pronouns
	// referring to patients or software agents. New personal wording is still
	// checked before passage masking, so copied phrases cannot hide new claims.
	const personal = Object.values(draft.texts).some(
		(text) =>
			text &&
			!agreed.some((source) => source.trim() === text.trim()) &&
			containsPersonalClaim(text),
	);
	const texts = Object.fromEntries(
		Object.entries(draft.texts).map(([where, text]) => [
			where,
			text === undefined ||
			(containsPersonalClaim(text) &&
				!agreed.some((source) => source.trim() === text.trim()))
				? text
				: undisclosedProjectText(text, agreed),
		]),
	);
	const checkedDraft = { ...draft, texts };

	return [
		...(personal
			? [
					"Repairs must describe project work, not people or personal claims",
				]
			: []),
		...(revision.rolesNeeded.some(
			(role) => !team.rolesNeeded.includes(role),
		)
			? ["A repair may not add new required roles"]
			: []),
		...(new Set(changes).size !== changes.length ||
		removed.length !== changes.length ||
		removed.some(
			(role) => !changes.includes(role as (typeof ROLES)[number]),
		)
			? ["Explain the actual work change for exactly every removed role"]
			: []),
		...needed
			.filter((role) =>
				revision.rolesNeeded.includes(role as (typeof ROLES)[number]),
			)
			.map((role) => `Required ${role} is still uncovered`),
		...revision.rolesNeeded
			.filter((role) => !covered.has(role))
			.map((role) => `No known teammate covers ${role}`),
		...(Object.keys(revision.roleWork).some(
			(role) =>
				!revision.rolesNeeded.includes(role as (typeof ROLES)[number]),
		) || revision.rolesNeeded.some((role) => !revision.roleWork[role])
			? ["roleWork must describe exactly the remaining roles"]
			: []),
		...checkDisclosure(owner.profile, 0, checkedDraft).map(
			() => "Proposal contains a non-public owner fact or invalid role",
		),
		...checkThirdParty(
			texts,
			Object.values(owner.contacts).map((contact) => contact.learned),
			"",
		).map(
			() =>
				"Proposal contains non-public information learned from another person",
		),
	];
}

export async function runRepair(
	client: LlmClient,
	world: World,
	{ onEvent }: { onEvent?: (event: RunEvent) => void } = {},
): Promise<{ world: World; proposed: number; applied: number }> {
	let proposed = 0;
	let applied = 0;
	const options = {
		onExchange: (exchange: Parameters<typeof exchangeEvent>[0]) =>
			onEvent?.(exchangeEvent(exchange)),
	};
	const teams = await Promise.all(
		world.teams.map(async (team): Promise<Team> => {
			const ownerId = team.members[0]!;
			const needed = stillNeeded(world, ownerId);
			if (team.status !== "tentative" || needed.length === 0) return team;
			const owner = world.agents[ownerId]!;
			let proposal: RepairProposal;
			try {
				({ data: proposal } = await brainOf(client, ownerId).chatJson(
					repairMessages(owner, team, needed),
					RepairProposal,
					{
						...options,
						about: { kind: "repair", level: 2 },
						maxAttempts: 2,
						check: (value) => repairProblems(world, team, value),
					},
				));
			} catch (error) {
				if (!(error instanceof StructuredOutputError)) throw error;
				onEvent?.({
					type: "repair",
					team: team.id,
					agent: ownerId,
					step: "result",
					applied: false,
					reason: "invalid_or_unavailable",
					fellBack: true,
				});
				return team;
			}
			onEvent?.({
				type: "repair",
				team: team.id,
				agent: ownerId,
				step: "proposal",
				...(proposal.revision
					? {
							revision: proposal.revision,
							removedWork: proposal.removedWork,
						}
					: {}),
				rationale: proposal.rationale,
				fellBack: false,
			});
			if (!proposal.revision) {
				onEvent?.({
					type: "repair",
					team: team.id,
					agent: ownerId,
					step: "result",
					applied: false,
					reason: "no_revision",
					fellBack: false,
				});
				return team;
			}
			proposed++;
			const votes = await Promise.all(
				team.members.map(async (id) => {
					try {
						const { data } = await brainOf(client, id).chatJson(
							repairVoteMessages(
								world.agents[id]!,
								team,
								proposal,
							),
							RepairVote,
							{
								...options,
								about: { kind: "repair-vote", level: 2 },
								check: (value) =>
									value.approve
										? confirmationProblems(
												world.agents[id]!,
												{
													...team,
													rolesNeeded:
														proposal.revision!
															.rolesNeeded,
												},
											)
										: [],
								maxAttempts: 1,
							},
						);
						onEvent?.({
							type: "repair",
							team: team.id,
							agent: id,
							step: "vote",
							approve: data.approve,
							cardConsistent: data.cardConsistent,
							rationale: data.rationale,
							fellBack: false,
						});
						return data.approve;
					} catch (error) {
						if (!(error instanceof StructuredOutputError))
							throw error;
						onEvent?.({
							type: "repair",
							team: team.id,
							agent: id,
							step: "vote",
							approve: false,
							fellBack: true,
						});
						return false;
					}
				}),
			);
			const unanimous = votes.every(Boolean);
			onEvent?.({
				type: "repair",
				team: team.id,
				agent: ownerId,
				step: "result",
				applied: unanimous,
				reason: unanimous ? "unanimous" : "rejected",
				fellBack: false,
			});
			if (!unanimous) return team;
			applied++;
			const revision = proposal.revision;
			const updated: Team = {
				...team,
				project: { title: revision.title, description: revision.pitch },
				problem: revision.problem,
				build: revision.build,
				roleWork: revision.roleWork,
				rolesNeeded: revision.rolesNeeded,
			};
			updated.roles = assignTeamRoles(world, updated);
			onEvent?.({ type: "team", team: updated });
			return updated;
		}),
	);
	return { world: { ...world, teams }, proposed, applied };
}
