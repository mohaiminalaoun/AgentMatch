import { z } from "zod";
import {
	contactOf,
	learn,
	raiseLevel,
	recordMessage,
	recordRevealed,
	type AgentMessage,
	type AgentState,
} from "./agent.js";
import type { LlmClient } from "./client.js";
import type { ProfileField } from "./disclosure.js";
import { exchangeEvent, type RunEvent } from "./events.js";
import { checkDisclosure } from "./gate.js";
import {
	StructuredOutputError,
	type ChatOptions,
	type Exchange,
	type Message,
} from "./llm.js";
import type { Profile } from "./profile.js";
import {
	JOIN_PREFIX,
	type Leave,
	type Offer,
	type OfferAnswer,
	type Share,
} from "./proposal.js";
import { continued, publicPitch, type World } from "./round.js";
import type { Team } from "./team.js";

// Both sides must have continued at this level before an offer: the highest level runRound opens.
const READY_LEVEL = 2;

// The most offer-and-commit passes in one commitment phase; they normally stop well before this.
const MAX_PASSES = 5;

// What an owner's model returns when more people are ready than it has places: whom to offer, best first.
export const AgentOffers = z.object({
	rationale: z.string().min(1),
	offer: z.array(z.string()),
});

export type AgentOffers = z.infer<typeof AgentOffers>;

// What a model returns about the offers its human holds: the owner whose team to join, or null for none.
export const AgentCommitment = z.object({
	rationale: z.string().min(1),
	commit: z.string().nullable(),
});

export type AgentCommitment = z.infer<typeof AgentCommitment>;

// What a member's model returns when its team has grown: stay, or leave at a cost.
export const AgentStay = z.object({
	rationale: z.string().min(1),
	decision: z.enum(["stay", "leave"]),
});

export type AgentStay = z.infer<typeof AgentStay>;

export type CommitmentOptions = {
	onExchange?: ChatOptions["onExchange"];
	onEvent?: (event: RunEvent) => void;
};

export type CommitmentResult = {
	world: World;
	offers: number;
	commits: number;
	// Members who left a team after it grew.
	departures: number;
	// How many offer-and-commit passes ran.
	passes: number;
	// True if mail from the round was still waiting, so nothing was offered.
	skipped: boolean;
};

// The team `id` is on, if any.
export function teamOf(world: World, id: string): Team | undefined {
	return world.teams.find((team) => team.members.includes(id));
}

// Everyone on `owner`'s team so far, owner first; just the owner if no one has joined.
function membersOf(world: World, owner: string): string[] {
	return teamOf(world, owner)?.members ?? [owner];
}

// The largest team `id` wants, as `owner` knows it: from its own profile for the owner, from what `id`
// shared at level 2 for anyone else, or no limit if they never said.
function maxSizeFor(world: World, owner: string, id: string): number {
	const preferences =
		id === owner
			? world.agents[owner]!.profile.preferences
			: contactOf(world.agents[owner]!, id).learned.preferences;
	return preferences?.maxTeamSize ?? Infinity;
}

// The roles `id` can fill, as `owner` knows them: skills from its own profile for the owner, from what `id`
// shared at level 2 for anyone else.
function rolesOf(world: World, owner: string, id: string): Set<string> {
	const skills =
		id === owner
			? world.agents[owner]!.profile.skills
			: contactOf(world.agents[owner]!, id).learned.skills;
	return new Set((skills ?? []).map((skill) => skill.name));
}

// The roles `owner`'s listing asks for that no one on its team fills yet. "any" (asked for by someone who
// already covers every core role) is filled by the first person to join.
export function stillNeeded(world: World, owner: string): string[] {
	const joined = membersOf(world, owner).slice(1);
	const covered = new Set(
		joined.flatMap((id) => [...rolesOf(world, owner, id)]),
	);
	return (publicPitch(world.agents[owner]!)?.rolesNeeded ?? []).filter(
		(role) => (role === "any" ? joined.length === 0 : !covered.has(role)),
	);
}

// The roles in `needed` that `id` would fill for `owner`.
function fills(
	world: World,
	owner: string,
	id: string,
	needed: readonly string[],
): string[] {
	const roles = rolesOf(world, owner, id);
	return needed.filter((role) => role === "any" || roles.has(role));
}

// Places `owner` still has: the smallest largest-team size among everyone on the team, minus its size, so the
// team never grows past what any member wants.
export function placesLeft(world: World, owner: string): number {
	const members = membersOf(world, owner);
	return (
		Math.min(...members.map((id) => maxSizeFor(world, owner, id))) -
		members.length
	);
}

// Whether `id` still takes part in discovery: on no team, or owning one with places left and roles still needed.
export function isOpen(world: World, id: string): boolean {
	const team = teamOf(world, id);
	return (
		!team ||
		(team.members[0] === id &&
			placesLeft(world, id) > 0 &&
			stillNeeded(world, id).length > 0)
	);
}

// Trims `ordered` (best first) to offers that can all be taken at once: each person must fill a role that
// neither the team nor anyone kept before them fills, and the resulting team must fit every member's largest
// size, theirs included.
export function selectOffers(
	world: World,
	owner: string,
	ordered: readonly string[],
): string[] {
	const size = membersOf(world, owner).length;
	let needed = stillNeeded(world, owner);
	let limit = size + placesLeft(world, owner);
	const kept: string[] = [];
	for (const id of ordered) {
		const filled = fills(world, owner, id, needed);
		const newLimit = Math.min(limit, maxSizeFor(world, owner, id));
		if (filled.length === 0 || size + kept.length + 1 > newLimit) {
			continue;
		}
		kept.push(id);
		limit = newLimit;
		needed = needed.filter((role) => !filled.includes(role));
	}
	return kept;
}

// Whose project the conversation between `a` and `b` is about: the owner of the last terms put on the table.
// A "join your project" proposal is about its recipient's project; any other proposal or counter is about its
// sender's. Someone with no project idea can't own one, so then it's the other side's.
export function projectOwner(
	world: World,
	a: string,
	b: string,
): string | undefined {
	const terms = contactOf(world.agents[a]!, b)
		.history.filter((m) => "pitch" in m)
		.at(-1);
	if (!terms || !("pitch" in terms)) {
		return undefined;
	}
	const owner = terms.pitch.startsWith(JOIN_PREFIX) ? terms.to : terms.from;
	const other = owner === a ? b : a;
	const hasIdea = (id: string) =>
		world.agents[id]!.profile.projectIdeas.length > 0;
	return hasIdea(owner) ? owner : hasIdea(other) ? other : undefined;
}

// Everyone `owner` could offer a place now: both continued through level 2 in a conversation about
// `owner`'s project, on no team yet, hasn't declined an offer from `owner` or left its team before, fills a
// role the team still needs, and wants a team at least as big as this one would become.
export function candidatesOf(world: World, owner: string): string[] {
	const agent = world.agents[owner]!;
	const needed = stillNeeded(world, owner);
	const size = membersOf(world, owner).length;
	return Object.keys(agent.contacts)
		.sort()
		.filter(
			(id) =>
				continued(agent, owner, id, READY_LEVEL) &&
				continued(agent, id, owner, READY_LEVEL) &&
				projectOwner(world, owner, id) === owner &&
				!teamOf(world, id) &&
				fills(world, owner, id, needed).length > 0 &&
				maxSizeFor(world, owner, id) >= size + 1 &&
				!contactOf(agent, id).history.some(
					(m) =>
						"kind" in m &&
						m.from === id &&
						((m.kind === "answer" && m.answer === "decline") ||
							m.kind === "leave"),
				),
		);
}

const INTRO =
	"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.";

// The prompt asking `owner` which of `candidates` get one of its `places`: its own profile, plus only what
// each candidate has shared with it.
export function offerMessages(
	owner: AgentState,
	candidates: readonly string[],
	places: number,
	// The public count of committed teams each candidate has left, for those who have.
	leftTeams: Record<string, number> = {},
	// The roles the team still needs.
	needed: readonly string[] = [],
): Message[] {
	return [
		{
			role: "system",
			content: [
				INTRO,
				`Your human's full profile (private; for your judgment only):\n${JSON.stringify(owner.profile, null, 2)}`,
				[
					`Your human's project is ${JSON.stringify(owner.profile.projectIdeas[0])}, and the team has ${places} place${places === 1 ? "" : "s"} left.`,
					"The people below are ready to join: you and each of them chose to keep going after sharing skills and preferences.",
					`Choose who gets an offer, at most ${places}, best first, by their id. An offer is binding: anyone who commits joins your human's team, and names are exchanged.`,
					`Roles the team still needs: ${needed.join(", ") || "any"}. Each offer should fill a different one; people who only duplicate a role already offered won't get one.`,
					"Prefer people whose skills cover different roles the project needs. leftTeams, where shown, is how many committed teams that person has left before; weigh their reliability. Your rationale is private.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: `Ready to join: ${JSON.stringify(candidates.map((id) => ({ id, shared: contactOf(owner, id).learned, ...(leftTeams[id] && { leftTeams: leftTeams[id] }) })))}`,
		},
	];
}

// The prompt asking `agent` which offer to commit to: its own profile, plus each owner's public pitch and
// what that owner has shared with it.
export function commitmentMessages(
	world: World,
	agent: AgentState,
	owners: readonly string[],
): Message[] {
	const offers = owners.map((id) => ({
		owner: id,
		project: publicPitch(world.agents[id]!),
		shared: contactOf(agent, id).learned,
	}));
	return [
		{
			role: "system",
			content: [
				INTRO,
				`Your human's full profile (private; for your judgment only):\n${JSON.stringify(agent.profile, null, 2)}`,
				[
					"The project owners below have offered your human a place on their team.",
					"Committing is final: your human joins that team, can't join any other, and their name is shared with every teammate.",
					"Commit to at most one, by its owner's id, or use null to decline them all. Choose where your human's skills are most needed and the project fits them best. Your rationale is private.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: `Offers: ${JSON.stringify(offers)}`,
		},
	];
}

// The prompt asking a member of `team`, which has just grown, whether its human stays: its own profile, the
// project, and what it knows about each teammate (a name, for anyone it never talked to).
export function recheckMessages(agent: AgentState, team: Team): Message[] {
	const teammates = team.members
		.filter((id) => id !== agent.id)
		.map((id) => ({ id, ...contactOf(agent, id).learned }));
	return [
		{
			role: "system",
			content: [
				INTRO,
				`Your human's full profile (private; for your judgment only):\n${JSON.stringify(agent.profile, null, 2)}`,
				[
					`Your human is committed to ${team.members[0]}'s team, building ${JSON.stringify(team.project)}. Someone new has joined, and the team is now ${team.members.length} people.`,
					"Decide whether your human stays or leaves.",
					'Leaving is costly: it breaks a commitment, the team loses someone it planned around, and your human gets a public mark ("left 1 team") that every agent sees when deciding whether to work with them. Leave only if the team is now clearly wrong for your human, for example bigger than they want.',
					"Only stay or leave is sent; your rationale is private.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: `Your teammates and what you know about each: ${JSON.stringify(teammates)}`,
		},
	];
}

// Turns ready pairs into committed teams, after a round's conversations have gone quiet, without anyone
// seeing the whole picture (deferred acceptance):
// 1. Each project owner offers its places to the people it's ready with. If there are more of them than
//    places, its model picks. An offer binds the owner.
// 2. Every agent holding offers picks one, all at once, so no offer wins by arriving first. Commit goes to
//    the pick and decline to the rest. An agent that sent offers is bound to its own project and answers
//    busy, which can be offered again.
// 3. A commit adds the member to the owner's team; the member and every teammate open level 3 and share
//    names, built by code and gate-checked.
//    Steps 1–3 repeat until a pass changes nothing, so someone busy in one pass can commit in the next.
// 4. In each team that grew, every earlier member (not the owner) re-checks: stay, or leave, which tells
//    each teammate, frees their place, and adds to the leaver's public `leftTeams`.
// Returns a new world; the one passed in is unchanged.
export async function runCommitment(
	client: LlmClient,
	world: World,
	{ onExchange, onEvent }: CommitmentOptions = {},
): Promise<CommitmentResult> {
	const { bus } = world;
	if (bus.waiting() > 0) {
		return {
			world,
			offers: 0,
			commits: 0,
			departures: 0,
			passes: 0,
			skipped: true,
		};
	}
	const agents = { ...world.agents };
	let teams = [...world.teams];
	const current = (): World => ({ ...world, agents, teams });
	const emit = (event: RunEvent) => onEvent?.(event);
	const llmOptions = {
		onExchange: (exchange: Exchange) => {
			onExchange?.(exchange);
			emit(exchangeEvent(exchange));
		},
	};

	const unsubscribe = bus.subscribe((event) => emit({ type: "bus", event }));
	try {
		return await play();
	} finally {
		unsubscribe();
	}

	async function play(): Promise<CommitmentResult> {
		// Steps 1–3 repeat until a pass changes nothing: a commit places someone and can free an owner who
		// was busy with its own offers; a decline rules a pair out. Both are finite, so the passes stop.
		const before = new Map(teams.map((t) => [t.id, t.members]));
		let offers = 0;
		let commits = 0;
		let passes = 0;
		while (passes < MAX_PASSES) {
			passes++;
			const pass = await offerAndCommit();
			offers += pass.offers;
			commits += pass.commits;
			if (pass.commits + pass.declines === 0) {
				break;
			}
		}

		// 4. Earlier members of teams that grew decide whether to stay.
		const toRecheck = teams.flatMap((team) => {
			const earlier = before.get(team.id) ?? [];
			return earlier.length < team.members.length
				? earlier.slice(1).map((member) => ({ member, team }))
				: [];
		});
		const rechecks = await Promise.all(
			toRecheck.map(({ member, team }) => recheck(member, team)),
		);
		let departures = 0;
		for (const result of rechecks) {
			emit({ type: "recheck", ...result });
			if (result.decision === "leave") {
				removeMember(result.agent, result.team);
				departures++;
			}
		}
		deliver();

		return {
			world: current(),
			offers,
			commits,
			departures,
			passes,
			skipped: false,
		};
	}

	// Sends `message` and records it, and what it revealed, in the sender's state.
	function send(message: AgentMessage, revealed: ProfileField[]) {
		bus.send(message.from, message);
		agents[message.from] = recordRevealed(
			recordMessage(agents[message.from]!, message.to, message),
			message.to,
			revealed,
		);
	}

	// Delivers every inbox, in id order, recording each message and learning each share.
	function deliver() {
		return Object.keys(agents)
			.sort()
			.flatMap((receiver) =>
				bus.receive(receiver).map((message) => {
					agents[receiver] = recordMessage(
						agents[receiver]!,
						message.from,
						message,
					);
					if ("kind" in message && message.kind === "share") {
						agents[receiver] = learn(
							agents[receiver]!,
							message.from,
							message.shared,
						);
					}
					return { receiver, message };
				}),
			);
	}

	// One pass of steps 1–3, returning what it sent.
	async function offerAndCommit() {
		// 1. Owners make offers.
		const owners = Object.keys(agents)
			.sort()
			.filter((id) => {
				const team = teamOf(current(), id);
				return (
					(!team || team.members[0] === id) &&
					placesLeft(current(), id) > 0 &&
					candidatesOf(current(), id).length > 0
				);
			});
		const choices = await Promise.all(
			owners.map((owner) => chooseMembers(owner)),
		);
		let offers = 0;
		for (const choice of choices) {
			emit({ type: "offers", ...choice });
			for (const to of choice.to) {
				const offer: Offer = {
					kind: "offer",
					from: choice.agent,
					to,
					team: teamId(choice.agent),
				};
				send(offer, []);
				offers++;
			}
		}
		const bound = new Set(
			choices.filter((c) => c.to.length > 0).map((c) => c.agent),
		);

		// 2. Everyone holding offers picks one at once. An owner with offers out is busy: it answers "busy",
		// which, unlike a decline, leaves it open to the same offer in a later pass.
		const held = new Map<string, string[]>();
		for (const { receiver, message } of deliver()) {
			held.set(receiver, [...(held.get(receiver) ?? []), message.from]);
		}
		const picks = await Promise.all(
			[...held].map(([agent, from]) =>
				bound.has(agent)
					? {
							agent,
							offers: from,
							chose: null,
							busy: true,
							rationale: undefined,
							fellBack: false,
						}
					: choosePlace(agent, from),
			),
		);
		let declines = 0;
		for (const pick of picks) {
			emit({ type: "commitment", ...pick });
			for (const owner of pick.offers) {
				const answer: OfferAnswer = {
					kind: "answer",
					from: pick.agent,
					to: owner,
					team: teamId(owner),
					answer:
						owner === pick.chose
							? "commit"
							: "busy" in pick
								? "busy"
								: "decline",
				};
				send(answer, []);
				if (answer.answer === "decline") {
					declines++;
				}
			}
		}

		// 3. Commits form teams, and teammates exchange names.
		let commits = 0;
		for (const { receiver, message } of deliver()) {
			if (
				"kind" in message &&
				message.kind === "answer" &&
				message.answer === "commit"
			) {
				addMember(receiver, message.from);
				commits++;
			}
		}
		deliver();
		return { offers, commits, declines };
	}

	// Whom `owner` offers a place: everyone ready if they can all be taken together, otherwise its model's
	// ranking, trimmed by selectOffers. If no valid ranking comes back, id order is used instead.
	async function chooseMembers(owner: string) {
		const candidates = candidatesOf(current(), owner);
		const places = placesLeft(current(), owner);
		// If everyone ready can be taken together, no choice is needed.
		const all = selectOffers(current(), owner, candidates);
		if (all.length === candidates.length) {
			return {
				agent: owner,
				to: all,
				places,
				rationale: undefined,
				fellBack: false,
			};
		}
		try {
			const { data } = await client.chatJson(
				offerMessages(
					agents[owner]!,
					candidates,
					places,
					Object.fromEntries(
						candidates
							.filter((id) => agents[id]!.leftTeams > 0)
							.map((id) => [id, agents[id]!.leftTeams]),
					),
					stillNeeded(current(), owner),
				),
				AgentOffers,
				{
					...llmOptions,
					check: ({ offer }) =>
						offer.flatMap((id) =>
							candidates.includes(id)
								? []
								: [
										`offer: "${id}" isn't one of the people ready to join; use their ids only`,
									],
						),
				},
			);
			return {
				agent: owner,
				to: selectOffers(current(), owner, [...new Set(data.offer)]),
				places,
				rationale: data.rationale,
				fellBack: false,
			};
		} catch (error) {
			if (!(error instanceof StructuredOutputError)) {
				throw error;
			}
			return {
				agent: owner,
				to: all,
				places,
				rationale: undefined,
				fellBack: true,
			};
		}
	}

	// Which offer `agent` commits to. If no valid answer comes back, it declines them all: a commitment
	// can't be undone, so not making one is the safe default.
	async function choosePlace(agent: string, owners: string[]) {
		try {
			const { data } = await client.chatJson(
				commitmentMessages(current(), agents[agent]!, owners),
				AgentCommitment,
				{
					...llmOptions,
					check: ({ commit }) =>
						commit === null || owners.includes(commit)
							? []
							: [
									`commit: "${commit}" didn't make an offer; use an owner's id from the offers, or null`,
								],
				},
			);
			return {
				agent,
				offers: owners,
				chose: data.commit,
				rationale: data.rationale,
				fellBack: false,
			};
		} catch (error) {
			if (!(error instanceof StructuredOutputError)) {
				throw error;
			}
			return {
				agent,
				offers: owners,
				chose: null,
				rationale: undefined,
				fellBack: true,
			};
		}
	}

	// Whether `member` stays on `team` now that it has grown. If no valid answer comes back, it stays:
	// leaving breaks a commitment and costs the human a public mark.
	async function recheck(member: string, team: Team) {
		try {
			const { data } = await client.chatJson(
				recheckMessages(agents[member]!, team),
				AgentStay,
				llmOptions,
			);
			return {
				agent: member,
				team: team.id,
				decision: data.decision,
				rationale: data.rationale,
				fellBack: false,
			};
		} catch (error) {
			if (!(error instanceof StructuredOutputError)) {
				throw error;
			}
			return {
				agent: member,
				team: team.id,
				decision: "stay" as const,
				rationale: undefined,
				fellBack: true,
			};
		}
	}

	// Takes `member` off team `id`: each teammate is told, and the member's public count of teams left goes up.
	// Names already shared stay known; nothing can unshare them. A team left with only its owner dissolves.
	function removeMember(member: string, id: string) {
		const team = teams.find((t) => t.id === id)!;
		for (const teammate of team.members.filter((m) => m !== member)) {
			const leave: Leave = {
				kind: "leave",
				from: member,
				to: teammate,
				team: id,
			};
			bus.send(member, leave);
			agents[member] = recordMessage(agents[member]!, teammate, leave);
		}
		agents[member] = {
			...agents[member]!,
			leftTeams: agents[member]!.leftTeams + 1,
		};
		const members = team.members.filter((m) => m !== member);
		teams = teams.filter((t) => t !== team);
		if (members.length >= 2) {
			const updated = { ...team, members };
			teams = [...teams, updated];
			emit({ type: "team", team: updated });
		}
	}

	// Puts `member` on `owner`'s team, creating it if needed, and has them swap names with every teammate.
	function addMember(owner: string, member: string) {
		const team = teams.find((t) => t.members[0] === owner);
		for (const teammate of team?.members ?? [owner]) {
			shareName(teammate, member);
			shareName(member, teammate);
		}
		const updated: Team = {
			id: teamId(owner),
			members: [...(team?.members ?? [owner]), member],
			project: agents[owner]!.profile.projectIdeas[0]!,
			status: "committed",
		};
		teams = [...teams.filter((t) => t !== team), updated];
		emit({ type: "team", team: updated });
	}

	// Opens level 3 from `from` to `to` and sends `from`'s name: a share built from the profile and checked
	// by the gate anyway, as a second line of defense.
	function shareName(from: string, to: string) {
		const agent = agents[from]!;
		const level = contactOf(agent, to).level;
		if (level < 3) {
			emit({ type: "level", agent: from, other: to, from: level, to: 3 });
			agents[from] = raiseLevel(agent, to, 3);
		}
		const shared: Partial<Profile> = { name: agent.profile.name };
		if (
			checkDisclosure(agent.profile, 3, { texts: {}, shared }).length > 0
		) {
			throw new Error(`name share from ${from} broke the rules`);
		}
		const share: Share = { kind: "share", from, to, level: 3, shared };
		bus.send(from, share);
		agents[from] = recordRevealed(
			recordMessage(agents[from]!, to, share),
			to,
			["name"],
		);
	}
}

// The id of the team `owner`'s project forms.
function teamId(owner: string): string {
	return `team-${owner}`;
}
