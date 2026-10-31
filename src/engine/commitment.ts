import { z } from "zod";
import { aboutHuman } from "./notes.js";
import {
	agreedTerms,
	agreedVersion,
	brainstormedWith,
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
import { factsText, fitFacts } from "./fit.js";
import { checkDisclosure, checkThirdParty } from "./gate.js";
import { CITE_FACTS, GOOD_TEAM } from "./goals.js";
import {
	StructuredOutputError,
	type ChatOptions,
	type Exchange,
	type Message,
} from "./llm.js";
import type { Profile } from "./profile.js";
import {
	BRAINSTORM_PITCH,
	isJoinRequest,
	termsOf,
	type Leave,
	type Offer,
	type OfferAnswer,
	type Share,
	type Terms,
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
	// Whether teammates swap names (level 3) as soon as they commit (default true). With real people, names wait
	// until every member's human has approved the team, outside the engine.
	revealNames?: boolean;
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

// The team's version of its project, once there's a team.
function teamTerms(team: Team): Terms {
	return {
		title: team.project.title,
		pitch: team.project.description,
		rolesNeeded: team.rolesNeeded,
	};
}

// The version of `owner`'s project that `id` would join: the team's if it has formed, otherwise the one
// `owner` and `id` agreed on, or the owner's public pitch if they agreed on none.
export function versionFor(
	world: World,
	owner: string,
	id: string,
): Terms | undefined {
	const team = teamOf(world, owner);
	return team
		? teamTerms(team)
		: (agreedTerms(world.agents[owner]!, id) ??
				publicPitch(world.agents[owner]!));
}

// Whether `owner` may send `version` to `id`: nothing in its pitch may reveal what `owner` learned from anyone
// other than `id`, unless `id` could already see it. A version agreed with someone else can carry what was
// learned about them, so it's checked before it reaches anyone new.
export function safeToOffer(
	world: World,
	owner: string,
	id: string,
	version: Terms,
): boolean {
	const agent = world.agents[owner]!;
	const others = Object.entries(agent.contacts)
		.filter(([other]) => other !== id)
		.map(([, contact]) => contact.learned);
	const contact = contactOf(agent, id);
	const known = JSON.stringify([
		agent.profile,
		contact.learned,
		contact.history,
	]);
	return (
		checkThirdParty(
			{
				...(version.title !== undefined && { title: version.title }),
				pitch: version.pitch,
			},
			others,
			known,
		).length === 0
	);
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

// The roles a version of `owner`'s project asks for that no one on its team fills yet: the team's version once
// it has formed, otherwise `version` if given, otherwise the owner's public listing. "any" (asked for by someone
// who already covers every core role) is filled by the first person to join.
export function stillNeeded(
	world: World,
	owner: string,
	version?: Terms,
): string[] {
	const team = teamOf(world, owner);
	const joined = membersOf(world, owner).slice(1);
	const covered = new Set(
		joined.flatMap((id) => [...rolesOf(world, owner, id)]),
	);
	const roles =
		(team
			? teamTerms(team)
			: (version ?? publicPitch(world.agents[owner]!))
		)?.rolesNeeded ?? [];
	return roles.filter((role) =>
		role === "any" ? joined.length === 0 : !covered.has(role),
	);
}

// Whether `id` wrote the version of `owner`'s project they'd join: before there's a team, a version agreed
// with `owner` and authored by `id`. Its roles list names what's needed from people other than `id`, so `id`
// has a place in it by design even though it lists no role they fill.
function wroteTheirVersion(world: World, owner: string, id: string): boolean {
	return (
		!teamOf(world, owner) &&
		agreedVersion(world.agents[owner]!, id)?.author === id
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

// Trims `ordered` (best first) to offers that can all be taken at once, for one version of the project: the
// team's, or, before there's a team, the one agreed with the first person kept. Each person must fill a role
// of that version that neither the team nor anyone kept before them fills, the version must be safe to send
// them, and the resulting team must fit every member's largest size, theirs included.
export function selectOffers(
	world: World,
	owner: string,
	ordered: readonly string[],
): string[] {
	return explainOffers(world, owner, ordered).kept;
}

// Someone `selectOffers` left out, and why, so a log shows when code overrode the owner's model.
export type DroppedOffer = { id: string; reason: string };

// What `selectOffers` keeps, plus everyone in `ordered` it drops, each with the reason.
export function explainOffers(
	world: World,
	owner: string,
	ordered: readonly string[],
): { kept: string[]; dropped: DroppedOffer[] } {
	const size = membersOf(world, owner).length;
	let version = teamOf(world, owner)
		? versionFor(world, owner, owner)
		: undefined;
	let needed = version ? stillNeeded(world, owner, version) : undefined;
	let limit = size + placesLeft(world, owner);
	// Who covers each role already: a team member, or someone kept before.
	const coveredBy = new Map<string, string>();
	for (const id of membersOf(world, owner).slice(1)) {
		for (const role of rolesOf(world, owner, id)) {
			coveredBy.set(role, coveredBy.get(role) ?? id);
		}
	}
	const kept: string[] = [];
	const dropped: DroppedOffer[] = [];
	for (const id of ordered) {
		const theirs = version ?? versionFor(world, owner, id);
		if (!theirs) {
			dropped.push({
				id,
				reason: "no version of the project agreed with them",
			});
			continue;
		}
		if (!safeToOffer(world, owner, id, theirs)) {
			dropped.push({
				id,
				reason: "the version would reveal something learned from someone else",
			});
			continue;
		}
		const stillOpen = needed ?? stillNeeded(world, owner, theirs);
		const filled = fills(world, owner, id, stillOpen);
		const theirMax = maxSizeFor(world, owner, id);
		const newLimit = Math.min(limit, theirMax);
		// Only the first person kept can be offered their own version; anyone after joins theirs.
		const ownPlace =
			kept.length === 0 &&
			!version &&
			wroteTheirVersion(world, owner, id);
		if (filled.length === 0 && !ownPlace) {
			const theirRoles = [...rolesOf(world, owner, id)].filter((role) =>
				theirs.rolesNeeded.includes(role),
			);
			dropped.push({
				id,
				reason:
					theirRoles.length === 0
						? `fills none of the roles needed (${stillOpen.join(", ") || "none left"})`
						: `every needed role they could fill is already covered: ${theirRoles
								.map(
									(role) =>
										`${role} by ${coveredBy.get(role) ?? "the team"}`,
								)
								.join(", ")}`,
			});
			continue;
		}
		if (size + kept.length + 1 > newLimit) {
			dropped.push({
				id,
				reason:
					theirMax < limit
						? `they want a team of at most ${theirMax}, and it would be ${size + kept.length + 1}`
						: `the team would pass its size limit of ${limit}`,
			});
			continue;
		}
		kept.push(id);
		limit = newLimit;
		version = theirs;
		for (const role of filled) {
			coveredBy.set(role, coveredBy.get(role) ?? id);
		}
		needed = stillOpen.filter((role) => !filled.includes(role));
	}
	return { kept, dropped };
}

// The version every offer in a pass carries: the team's, or the one agreed with the first person offered.
export function offerVersion(
	world: World,
	owner: string,
	to: readonly string[],
): Terms | undefined {
	return teamOf(world, owner) || to.length === 0
		? versionFor(world, owner, owner)
		: versionFor(world, owner, to[0]!);
}

// Whose project the conversation between `a` and `b` is about. For two people who brainstormed, whoever wrote
// the idea they agreed on, idea of their own or not. Otherwise, the author of the version they agreed on,
// since its roles list names what's needed from people other than the author. Before they agree on one, it's
// the owner of the last terms on the table: a "join your project" request is about its recipient's project,
// any other proposal or counter is about its sender's. Someone with no project idea can't own one, so then
// it's the other side's.
export function projectOwner(
	world: World,
	a: string,
	b: string,
): string | undefined {
	const agreed = agreedVersion(world.agents[a]!, b);
	// Two people who brainstormed own whatever one of them came up with, idea of their own or not; until they
	// agree on a real idea, nobody owns anything.
	if (brainstormedWith(world.agents[a]!, b)) {
		return agreed && agreed.terms.pitch !== BRAINSTORM_PITCH
			? agreed.author
			: undefined;
	}
	const terms = contactOf(world.agents[a]!, b)
		.history.filter((m) => "pitch" in m && !("kind" in m))
		.at(-1);
	const owner =
		agreed?.author ??
		(terms && "pitch" in terms
			? isJoinRequest(terms)
				? terms.to
				: terms.from
			: undefined);
	if (!owner) {
		return undefined;
	}
	const other = owner === a ? b : a;
	const hasIdea = (id: string) =>
		world.agents[id]!.profile.projectIdeas.length > 0;
	return hasIdea(owner) ? owner : hasIdea(other) ? other : undefined;
}

// Everyone `owner` could offer a place now: both continued through level 2 in a conversation about
// `owner`'s project, on no team yet, hasn't declined an offer from `owner` or left its team before, fills a
// role still needed by the version they'd join (or wrote that version themselves), and wants a team at least
// as big as this one would become.
export function candidatesOf(world: World, owner: string): string[] {
	return explainCandidates(world, owner).candidates;
}

// Everyone `owner` reached level 2 with, split into the people it could offer a place and the rest, each with
// the first check that ruled them out, so a log shows why a conversation that got far never became an offer.
export function explainCandidates(
	world: World,
	owner: string,
): { candidates: string[]; excluded: DroppedOffer[] } {
	const agent = world.agents[owner]!;
	const size = membersOf(world, owner).length;
	const candidates: string[] = [];
	const excluded: DroppedOffer[] = [];
	for (const id of Object.keys(agent.contacts).sort()) {
		const contact = contactOf(agent, id);
		const reached =
			contact.level >= READY_LEVEL ||
			continued(agent, owner, id, READY_LEVEL) ||
			continued(agent, id, owner, READY_LEVEL);
		if (!reached) {
			continue;
		}
		const reason = exclusion(world, owner, id, size, contact.history);
		if (reason) {
			excluded.push({ id, reason });
		} else {
			candidates.push(id);
		}
	}
	return { candidates, excluded };
}

// Why `owner` can't offer `id` a place, or undefined if it can.
function exclusion(
	world: World,
	owner: string,
	id: string,
	size: number,
	history: readonly AgentMessage[],
): string | undefined {
	const agent = world.agents[owner]!;
	if (!continued(agent, owner, id, READY_LEVEL)) {
		return "the owner hasn't continued at level 2";
	}
	if (!continued(agent, id, owner, READY_LEVEL)) {
		return "they haven't continued at level 2";
	}
	const projectBy = projectOwner(world, owner, id);
	if (projectBy !== owner) {
		return projectBy === id
			? "the version agreed with them is theirs, so they would own the team"
			: "nobody owns the version agreed with them yet";
	}
	if (teamOf(world, id)) {
		return "already on a team";
	}
	const needed = stillNeeded(world, owner, versionFor(world, owner, id));
	if (
		fills(world, owner, id, needed).length === 0 &&
		!wroteTheirVersion(world, owner, id)
	) {
		return `fills none of the roles still needed (${needed.join(", ") || "none left"})`;
	}
	const theirMax = maxSizeFor(world, owner, id);
	if (theirMax < size + 1) {
		return `they want a team of at most ${theirMax}, and it would be ${size + 1}`;
	}
	const ended = history.find(
		(m) =>
			"kind" in m &&
			m.from === id &&
			((m.kind === "answer" && m.answer === "decline") ||
				m.kind === "leave"),
	);
	if (ended) {
		return "kind" in ended && ended.kind === "leave"
			? "they left the team before"
			: "they declined an offer before";
	}
	return undefined;
}

const INTRO =
	"You are an AI agent forming hackathon teams on behalf of one person, your human. Act in their interest.";

// The prompt asking `owner` which of `candidates` get one of its `places`: its own profile, plus only what
// each candidate has shared with it, and the version of the project the team would build: the team's, once it
// exists, otherwise the one agreed with each candidate, since the first one offered decides it.
export function offerMessages(
	owner: AgentState,
	candidates: readonly string[],
	places: number,
	// The public count of committed teams each candidate has left, for those who have.
	leftTeams: Record<string, number> = {},
	// The roles the team still needs.
	needed: readonly string[] = [],
	// The team's version once it exists; otherwise the version agreed with each candidate.
	versions: { team: Terms } | { agreed: Record<string, Terms> } = {
		agreed: {},
	},
): Message[] {
	const agreed = "agreed" in versions ? versions.agreed : {};
	const plural = places === 1 ? "" : "s";
	return [
		{
			role: "system",
			content: [
				INTRO,
				aboutHuman(owner, 2),
				GOOD_TEAM,
				factsAbout(owner, candidates),
				[
					"team" in versions
						? `Your human's team is building this version of the project: ${JSON.stringify(versions.team)}. It has ${places} place${plural} left.`
						: `Your human has no team yet, and it has ${places} place${plural}. Each person below shows the version of the project you agreed with them: the team builds the version agreed with whoever you put first, and anyone after them joins that version.`,
					"The people below are ready to join: you and each of them chose to keep going after sharing skills and preferences.",
					`Choose who gets an offer, at most ${places}, best first, by their id. An offer is binding: anyone who commits joins your human's team, and names are exchanged.`,
					`Roles the team still needs: ${needed.join(", ") || "any"}. Each offer should fill a different one; people who only duplicate a role already offered won't get one.`,
					"Prefer people whose skills cover different roles the project needs. leftTeams, where shown, is how many committed teams that person has left before; weigh their reliability. Your rationale is private.",
					CITE_FACTS,
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: `Ready to join: ${JSON.stringify(candidates.map((id) => ({ id, shared: contactOf(owner, id).learned, ...(agreed[id] && { version: agreed[id] }), ...(leftTeams[id] && { leftTeams: leftTeams[id] }) })))}`,
		},
	];
}

// The computed facts about each of `ids`, as `agent` knows them, one block each.
function factsAbout(agent: AgentState, ids: readonly string[]): string {
	return ids.map((id) => factsText(fitFacts(agent, id))).join("\n\n");
}

// The prompt asking `agent` which offer to commit to: its own profile, plus every option side by side in the
// same shape: the version of the project each team will build, how big the team is now, and the computed
// facts about the person behind it. An owner deciding whether to lead also sees its own team as an option:
// its own version and the facts about each person it would offer a place.
export function commitmentMessages(
	agent: AgentState,
	held: readonly Offer[],
	offeringTo: readonly string[] = [],
	{
		sizes = {},
		ownVersion,
	}: {
		// Each offering owner's team size now, the owner included.
		sizes?: Record<string, number>;
		// The version the agent's own team would build, if it leads.
		ownVersion?: Terms | undefined;
	} = {},
): Message[] {
	const offers = held.map((offer) => ({
		owner: offer.from,
		project: termsOf(offer),
		...(sizes[offer.from] !== undefined && {
			teamSize: sizes[offer.from],
		}),
		shared: contactOf(agent, offer.from).learned,
	}));
	const options = [
		...held.map(
			(offer) =>
				`Option ${offer.from}: join ${offer.from}'s team${sizes[offer.from] !== undefined ? ` (${sizes[offer.from]} ${sizes[offer.from] === 1 ? "person" : "people"} now, ${sizes[offer.from]! + 1} with your human)` : ""}, building ${JSON.stringify(termsOf(offer))}.\n${factsAbout(agent, [offer.from])}`,
		),
		...(offeringTo.length > 0
			? [
					`Option null: lead your human's own project${ownVersion ? `, building ${JSON.stringify(ownVersion)}` : ""}, offering places to ${offeringTo.join(", ")}.\n${factsAbout(agent, offeringTo)}`,
				]
			: []),
	];
	return [
		{
			role: "system",
			content: [
				INTRO,
				aboutHuman(agent, 2),
				GOOD_TEAM,
				[
					"The project owners below have offered your human a place on their team. Each offer shows the version of the project the team will build.",
					"Committing is final: your human joins that team, can't join any other, and their name is shared with every teammate.",
					...(offeringTo.length > 0
						? [
								`Your human also owns a project, and is about to offer places on it to ${offeringTo.join(", ")}. Committing to one of these offers means joining that team instead, and your human's own offers are never sent. Use null to lead your human's own project instead.`,
								"Commit to at most one, by its owner's id, or use null to lead.",
							]
						: [
								"Commit to at most one, by its owner's id, or use null to decline them all.",
							]),
					"A team's size now isn't final: after your human joins, its owner can offer more places, and those people may cover roles nobody on it covers yet. Judge a team that is still below your human's minimum size by whether it can grow to fit, not as if it were complete.",
					"Compare the options side by side against the standard above, each as it's shown below: the project as its version describes it, the team's size, and the facts. Your rationale is private.",
					CITE_FACTS,
				].join("\n"),
				["Your options:", ...options].join("\n\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: [
				`Offers: ${JSON.stringify(offers)}`,
				...(offeringTo.length > 0
					? [
							`Your human's own team, if they lead: ${JSON.stringify(
								offeringTo.map((id) => ({
									id,
									shared: contactOf(agent, id).learned,
								})),
							)}`,
						]
					: []),
			].join("\n"),
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
				aboutHuman(agent, 2),
				GOOD_TEAM,
				[
					`Your human is committed to ${team.members[0]}'s team, building ${JSON.stringify(team.project)}. Someone new has joined, and the team is now ${team.members.length} people.`,
					"Decide whether your human stays or leaves.",
					'Leaving is costly: it breaks a commitment, the team loses someone it planned around, and your human gets a public mark ("left 1 team") that every agent sees when deciding whether to work with them. Leave only if the team is now clearly wrong for your human, for example bigger than they want.',
					"Only stay or leave is sent; your rationale is private.",
					CITE_FACTS,
				].join("\n"),
				factsAbout(
					agent,
					team.members.filter(
						(id) =>
							id !== agent.id &&
							contactOf(agent, id).learned.skills !== undefined,
					),
				),
			]
				.filter(Boolean)
				.join("\n\n"),
		},
		{
			role: "user",
			content: `Your teammates and what you know about each: ${JSON.stringify(teammates)}`,
		},
	];
}

// Turns ready pairs into committed teams, after a round's conversations have gone quiet, without anyone
// seeing the whole picture (deferred acceptance):
// 1. Each project owner chooses whom to offer its places, among the people it's ready with. If there are
//    more of them than places, its model picks. Nothing is sent yet.
// 2. An owner with no team yet who is being offered a place decides first: lead, sending its offers, which
//    bind it; or join one of those teams, so its own offers are never sent. A join holds only if the owner
//    joined leads; otherwise the joiner is busy for this pass.
// 2b. Every other agent holding offers picks one, all at once, so no offer wins by arriving first. Commit
//    goes to the pick and decline to the rest. An owner that leads answers busy, which can be offered again.
// 3. A commit adds the member to the owner's team; the member and every teammate open level 3 and share
//    names, built by code and gate-checked.
//    Steps 1–3 repeat until a pass changes nothing, so someone busy in one pass can commit in the next.
// 4. In each team that grew, every earlier member (not the owner) re-checks: stay, or leave, which tells
//    each teammate, frees their place, and adds to the leaver's public `leftTeams`.
// Returns a new world; the one passed in is unchanged.
export async function runCommitment(
	client: LlmClient,
	world: World,
	{ revealNames = true, onExchange, onEvent }: CommitmentOptions = {},
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
		// The offers each owner plans to make. None is sent until owners being offered a place have decided.
		const planned = choices.flatMap((choice) => {
			const version = offerVersion(current(), choice.agent, choice.to);
			return (version ? choice.to : []).map((to): Offer => ({
				kind: "offer",
				from: choice.agent,
				to,
				team: teamId(choice.agent),
				...version!,
			}));
		});
		const bound = new Set(
			choices.filter((c) => c.to.length > 0).map((c) => c.agent),
		);

		// 2. An owner with no team yet who is being offered a place decides first: lead its own project, or
		// join one of those teams, in which case its own offers are never sent. A join only holds if the
		// owner joined leads; otherwise the joiner is busy this pass and can try again in the next.
		const deciding = [...bound].filter(
			(owner) =>
				!teamOf(current(), owner) &&
				planned.some((offer) => offer.to === owner),
		);
		const decided = new Map(
			await Promise.all(
				deciding.map(
					async (owner) =>
						[
							owner,
							await choosePlace(
								owner,
								planned.filter((offer) => offer.to === owner),
								planned
									.filter((offer) => offer.from === owner)
									.map((offer) => offer.to),
							),
						] as const,
				),
			),
		);
		const joining = (owner: string) => decided.get(owner)?.chose != null;
		for (const choice of choices) {
			if (!joining(choice.agent)) {
				emit({ type: "offers", ...choice });
			}
		}
		let offers = 0;
		for (const offer of planned) {
			if (!joining(offer.from)) {
				send(offer, []);
				offers++;
			}
		}

		// 3. Everyone else holding offers picks one at once. An owner who leads is busy: it answers "busy",
		// which, unlike a decline, leaves it open to the same offer in a later pass.
		const held = new Map<string, Offer[]>();
		for (const { receiver, message } of deliver()) {
			if ("kind" in message && message.kind === "offer") {
				held.set(receiver, [...(held.get(receiver) ?? []), message]);
			}
		}
		const picks = await Promise.all(
			[...held].map(([agent, offers]) => {
				const owners = offers.map((o) => o.from);
				const decision = decided.get(agent);
				// A join holds if the owner joined sent its offers; anything else from a bound owner is busy.
				if (decision?.chose && owners.includes(decision.chose)) {
					return { ...decision, offers: owners };
				}
				return bound.has(agent)
					? {
							agent,
							offers: owners,
							chose: null,
							busy: true,
							rationale: decision?.rationale,
							fellBack: decision?.fellBack ?? false,
						}
					: choosePlace(agent, offers);
			}),
		);
		// A joiner whose owner didn't lead may hold nothing that was sent: its decision is recorded, but
		// it answers no one, since no offer reached it.
		for (const d of decided.values()) {
			if (!held.has(d.agent)) {
				emit({ type: "commitment", ...d, chose: null, busy: true });
			}
		}
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
				// The version this owner offered, which is what the member committed to.
				const offer = contactOf(agents[receiver]!, message.from)
					.history.filter(
						(m): m is Offer => "kind" in m && m.kind === "offer",
					)
					.at(-1)!;
				addMember(receiver, message.from, termsOf(offer));
				commits++;
			}
		}
		deliver();
		return { offers, commits, declines };
	}

	// Whom `owner` offers a place: everyone ready if they can all be taken together, otherwise its model's
	// ranking, trimmed by selectOffers. If no valid ranking comes back, id order is used instead. Anyone the
	// model ranked (or, on a fallback, anyone ready) whom the trimming drops is reported with the reason.
	async function chooseMembers(owner: string) {
		const { candidates, excluded } = explainCandidates(current(), owner);
		const places = placesLeft(current(), owner);
		const notConsidered = excluded.length > 0 ? { excluded } : {};
		// If everyone ready can be taken together, no choice is needed.
		const all = selectOffers(current(), owner, candidates);
		if (all.length === candidates.length) {
			return {
				agent: owner,
				to: all,
				places,
				rationale: undefined,
				fellBack: false,
				...notConsidered,
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
					teamOf(current(), owner)
						? { team: versionFor(current(), owner, owner)! }
						: {
								agreed: Object.fromEntries(
									candidates.flatMap((id) => {
										const version = versionFor(
											current(),
											owner,
											id,
										);
										return version ? [[id, version]] : [];
									}),
								),
							},
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
			const ranked = [...new Set(data.offer)];
			const { kept, dropped } = explainOffers(current(), owner, ranked);
			return {
				agent: owner,
				to: kept,
				places,
				rationale: data.rationale,
				fellBack: false,
				ranked,
				...(dropped.length > 0 && { dropped }),
				...notConsidered,
			};
		} catch (error) {
			if (!(error instanceof StructuredOutputError)) {
				throw error;
			}
			const { dropped } = explainOffers(current(), owner, candidates);
			return {
				agent: owner,
				to: all,
				places,
				rationale: undefined,
				fellBack: true,
				...(dropped.length > 0 && { dropped }),
				...notConsidered,
			};
		}
	}

	// Which offer `agent` commits to. If no valid answer comes back, it declines them all: a commitment
	// can't be undone, so not making one is the safe default.
	async function choosePlace(
		agent: string,
		held: Offer[],
		offeringTo: string[] = [],
	) {
		const owners = held.map((offer) => offer.from);
		try {
			const { data } = await client.chatJson(
				commitmentMessages(agents[agent]!, held, offeringTo, {
					sizes: Object.fromEntries(
						owners.map((owner) => [
							owner,
							membersOf(current(), owner).length,
						]),
					),
					ownVersion:
						offeringTo.length > 0
							? offerVersion(current(), agent, offeringTo)
							: undefined,
				}),
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

	// Puts `member` on `owner`'s team, creating it from `version` (the version they committed to) if needed,
	// and has them swap names with every teammate. An existing team keeps its version.
	function addMember(owner: string, member: string, version: Terms) {
		const team = teams.find((t) => t.members[0] === owner);
		for (const teammate of revealNames ? (team?.members ?? [owner]) : []) {
			shareName(teammate, member);
			shareName(member, teammate);
		}
		const updated: Team = {
			id: teamId(owner),
			members: [...(team?.members ?? [owner]), member],
			project: team?.project ?? {
				// The title agreed with the version. Older versions have none: then the owner's idea keeps its
				// title only while the team builds the pitch they listed, and anything else is a new project.
				title:
					version.title ??
					(version.pitch === publicPitch(agents[owner]!)?.pitch
						? (agents[owner]!.profile.projectIdeas[0]?.title ??
							"New project")
						: "New project"),
				description: version.pitch,
			},
			rolesNeeded: team?.rolesNeeded ?? version.rolesNeeded,
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
