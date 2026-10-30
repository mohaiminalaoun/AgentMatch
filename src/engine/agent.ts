import type { DisclosureLevel, ProfileField } from "./disclosure.js";
import type { Note } from "./notes.js";
import type { Profile } from "./profile.js";
import type {
	Interest,
	Offer,
	Leave,
	OfferAnswer,
	Proposal,
	ProposalResponse,
	Revision,
	RevisionAnswer,
	Share,
	Terms,
} from "./proposal.js";
import { BRAINSTORM_PITCH, JOIN_PREFIX, termsOf } from "./proposal.js";

export type AgentMessage =
	| Proposal
	| ProposalResponse
	| Share
	| Interest
	| Offer
	| OfferAnswer
	| Leave
	| Revision
	| RevisionAnswer;

// What one agent knows about its relationship with another.
export type Contact = {
	// How much this agent may currently share with them; only ever goes up.
	level: DisclosureLevel;
	// Profile fields this agent has sent them, for the leakage metric.
	revealed: ProfileField[];
	// What they've told this agent about their human, merged as they share more.
	learned: Partial<Profile>;
	// Proposals and responses between the two, oldest first.
	history: AgentMessage[];
};

// An agent's whole memory. Plain data, never changed in place: every update returns a new state,
// so logged snapshots stay accurate and states survive JSON round trips for replay.
export type AgentState = {
	id: string;
	// Its own human's full profile; never shared directly.
	profile: Profile;
	// What it shows on the public board, written once by its model and gate-checked at level 0.
	// Undefined until written; then the board falls back to a pitch built from the first project idea.
	listing: Terms | undefined;
	contacts: Record<string, Contact>;
	// How many committed teams its human has left. Public: the board and every proposal it sends show it,
	// so others can weigh reliability.
	leftTeams: number;
	// Its human's private notes, each with the level at which it may draw on them. Never sent as data: prompts
	// include only the notes their level allows.
	notes: Note[];
};

// A new agent for `profile`'s human, using the profile's id, with no contacts yet, and the human's notes.
export function createAgent(
	profile: Profile,
	notes: readonly Note[] = [],
): AgentState {
	return {
		id: profile.id,
		profile,
		listing: undefined,
		contacts: {},
		leftTeams: 0,
		notes: [...notes],
	};
}

// The agent's contact with `otherId`, or a fresh level-0 contact that knows nothing if they haven't met.
export function contactOf(state: AgentState, otherId: string): Contact {
	return (
		state.contacts[otherId] ?? {
			level: 0,
			revealed: [],
			learned: {},
			history: [],
		}
	);
}

// Moves the relationship up to `level`; lowering does nothing, since what was shared can't be unshared.
export function raiseLevel(
	state: AgentState,
	otherId: string,
	level: DisclosureLevel,
): AgentState {
	return updateContact(state, otherId, (contact) => ({
		...contact,
		level: level > contact.level ? level : contact.level,
	}));
}

// Notes that `fields` were sent to `otherId`; each field is kept once.
export function recordRevealed(
	state: AgentState,
	otherId: string,
	fields: readonly ProfileField[],
): AgentState {
	return updateContact(state, otherId, (contact) => ({
		...contact,
		revealed: [...new Set([...contact.revealed, ...fields])],
	}));
}

// Profile fields as they arrive in a message: any may be missing or explicitly undefined.
export type SharedFields = { [K in keyof Profile]?: Profile[K] | undefined };

// Merges what `otherId` shared into what this agent knows about them, skipping undefined values.
// Only call it with what was actually in a received message.
export function learn(
	state: AgentState,
	otherId: string,
	shared: SharedFields,
): AgentState {
	const present = Object.fromEntries(
		Object.entries(shared).filter(([, value]) => value !== undefined),
	) as Partial<Profile>;
	return updateContact(state, otherId, (contact) => ({
		...contact,
		learned: { ...contact.learned, ...present },
	}));
}

// Adds a proposal or response to the conversation with `otherId`.
export function recordMessage(
	state: AgentState,
	otherId: string,
	message: AgentMessage,
): AgentState {
	return updateContact(state, otherId, (contact) => ({
		...contact,
		history: [...contact.history, message],
	}));
}

// Returns a new state with `otherId`'s contact replaced by `change(contact)`.
function updateContact(
	state: AgentState,
	otherId: string,
	change: (contact: Contact) => Contact,
): AgentState {
	if (otherId === state.id) {
		throw new Error(`agent ${state.id} can't have itself as a contact`);
	}
	return {
		...state,
		contacts: {
			...state.contacts,
			[otherId]: change(contactOf(state, otherId)),
		},
	};
}

// A version of the project, and whose it is: whoever wrote its roles list, which names roles needed from
// people other than them. A "join your project" request is the recipient's pitch, so it's theirs.
export type Version = { terms: Terms; author: string };

// The version of the project `agent` and `otherId` last agreed on: the last proposal or counter that was
// accepted, or the last revision that was adopted, whichever came later. A "join your project" request
// agrees to the recipient's pitch, so the prefix is dropped. Undefined if nothing has been agreed. Both
// sides may send a revision in the same tick, so an answer adopts the latest revision from the side it
// replies to, not the latest revision overall.
export function agreedVersion(
	agent: AgentState,
	otherId: string,
): Version | undefined {
	let onTable: Version | undefined;
	const revised = new Map<string, Version>();
	let agreed: Version | undefined;
	for (const m of contactOf(agent, otherId).history) {
		if ("pitch" in m && !("kind" in m)) {
			const joins = m.pitch.startsWith(JOIN_PREFIX);
			onTable = {
				terms: {
					...termsOf(m),
					pitch: joins ? m.pitch.slice(JOIN_PREFIX.length) : m.pitch,
				},
				author: joins ? m.to : m.from,
			};
		} else if ("decision" in m && m.decision === "accept") {
			agreed = onTable;
		} else if ("kind" in m && m.kind === "revision") {
			revised.set(m.from, {
				terms: termsOf(m),
				author: m.from,
			});
		} else if ("kind" in m && m.kind === "revisionAnswer" && m.adopt) {
			agreed = revised.get(m.to);
		}
	}
	return agreed;
}

// Just the terms of the agreed version.
export function agreedTerms(
	agent: AgentState,
	otherId: string,
): Terms | undefined {
	return agreedVersion(agent, otherId)?.terms;
}

// The most revisions one conversation may have, from both sides together.
export const MAX_REVISIONS = 2;

// How many revisions have gone back and forth with `otherId`.
export function revisionsWith(agent: AgentState, otherId: string): number {
	return contactOf(agent, otherId).history.filter(
		(m) => "kind" in m && m.kind === "revision",
	).length;
}

// Whether `agent`'s conversation with `otherId` is a brainstorm: one of them proposed coming up with a project
// together.
export function brainstormedWith(agent: AgentState, otherId: string): boolean {
	return contactOf(agent, otherId).history.some(
		(m) => "pitch" in m && !("kind" in m) && m.pitch === BRAINSTORM_PITCH,
	);
}
