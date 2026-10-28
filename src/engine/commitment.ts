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
	type Offer,
	type OfferAnswer,
	type Share,
} from "./proposal.js";
import { continued, publicPitch, type World } from "./round.js";
import type { Team } from "./team.js";

// Both sides must have continued at this level before an offer: the highest level runRound opens.
const READY_LEVEL = 2;

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

export type CommitmentOptions = {
	onExchange?: ChatOptions["onExchange"];
	onEvent?: (event: RunEvent) => void;
};

export type CommitmentResult = {
	world: World;
	offers: number;
	commits: number;
	// True if mail from the round was still waiting, so nothing was offered.
	skipped: boolean;
};

// The team `id` is on, if any.
export function teamOf(world: World, id: string): Team | undefined {
	return world.teams.find((team) => team.members.includes(id));
}

// Places `owner` still has: its human's largest preferred team size, minus everyone already on the team.
export function placesLeft(world: World, owner: string): number {
	const size = teamOf(world, owner)?.members.length ?? 1;
	return world.agents[owner]!.profile.preferences.maxTeamSize - size;
}

// Whether `id` still takes part in discovery: on no team, or owning one with places left.
export function isOpen(world: World, id: string): boolean {
	const team = teamOf(world, id);
	return !team || (team.members[0] === id && placesLeft(world, id) > 0);
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
// `owner`'s project, on no team yet, and hasn't declined an offer from `owner` before.
export function candidatesOf(world: World, owner: string): string[] {
	const agent = world.agents[owner]!;
	return Object.keys(agent.contacts)
		.sort()
		.filter(
			(id) =>
				continued(agent, owner, id, READY_LEVEL) &&
				continued(agent, id, owner, READY_LEVEL) &&
				projectOwner(world, owner, id) === owner &&
				!teamOf(world, id) &&
				!contactOf(agent, id).history.some(
					(m) =>
						"kind" in m &&
						m.kind === "answer" &&
						m.from === id &&
						m.answer === "decline",
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
					"Prefer people whose skills cover different roles the project needs. Your rationale is private.",
				].join("\n"),
			].join("\n\n"),
		},
		{
			role: "user",
			content: `Ready to join: ${JSON.stringify(candidates.map((id) => ({ id, shared: contactOf(owner, id).learned })))}`,
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

// Turns ready pairs into committed teams, after a round's conversations have gone quiet, without anyone
// seeing the whole picture (deferred acceptance):
// 1. Each project owner offers its places to the people it's ready with. If there are more of them than
//    places, its model picks. An offer binds the owner.
// 2. Every agent holding offers picks one, all at once, so no offer wins by arriving first. Commit goes to
//    the pick and decline to the rest. An agent that sent offers is bound to its own project and declines.
// 3. A commit adds the member to the owner's team; the member and every teammate open level 3 and share
//    names, built by code and gate-checked.
// Returns a new world; the one passed in is unchanged.
export async function runCommitment(
	client: LlmClient,
	world: World,
	{ onExchange, onEvent }: CommitmentOptions = {},
): Promise<CommitmentResult> {
	const { bus } = world;
	if (bus.waiting() > 0) {
		return { world, offers: 0, commits: 0, skipped: true };
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
		// Sends `message` and records it, and what it revealed, in the sender's state.
		const send = (message: AgentMessage, revealed: ProfileField[]) => {
			bus.send(message.from, message);
			agents[message.from] = recordRevealed(
				recordMessage(agents[message.from]!, message.to, message),
				message.to,
				revealed,
			);
		};
		// Delivers every inbox, in id order, recording each message and learning each share.
		const deliver = () =>
			Object.keys(agents)
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

		// 2. Everyone holding offers picks one at once.
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
							rationale: undefined,
							fellBack: false,
						}
					: choosePlace(agent, from),
			),
		);
		for (const pick of picks) {
			emit({ type: "commitment", ...pick });
			for (const owner of pick.offers) {
				const answer: OfferAnswer = {
					kind: "answer",
					from: pick.agent,
					to: owner,
					team: teamId(owner),
					answer: owner === pick.chose ? "commit" : "decline",
				};
				send(answer, []);
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

		return { world: current(), offers, commits, skipped: false };
	}

	// Whom `owner` offers a place: everyone ready if they fit, otherwise its model's picks. If no valid pick
	// comes back, the first ready people in id order get the places.
	async function chooseMembers(owner: string) {
		const candidates = candidatesOf(current(), owner);
		const places = placesLeft(current(), owner);
		if (candidates.length <= places) {
			return {
				agent: owner,
				to: candidates,
				places,
				rationale: undefined,
				fellBack: false,
			};
		}
		try {
			const { data } = await client.chatJson(
				offerMessages(agents[owner]!, candidates, places),
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
				to: [...new Set(data.offer)].slice(0, places),
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
				to: candidates.slice(0, places),
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
