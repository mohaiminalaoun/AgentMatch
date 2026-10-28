import type { DisclosureLevel, ProfileField } from "./disclosure.js";
import type { Profile } from "./profile.js";
import type {
	Interest,
	Proposal,
	ProposalResponse,
	Share,
} from "./proposal.js";

export type AgentMessage = Proposal | ProposalResponse | Share | Interest;

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
	contacts: Record<string, Contact>;
};

// A new agent for `profile`'s human, using the profile's id, with no contacts yet.
export function createAgent(profile: Profile): AgentState {
	return { id: profile.id, profile, contacts: {} };
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
