import type { AgentMessage } from "./agent.js";
import { Proposal, ProposalResponse, Share } from "./proposal.js";

// Everything the bus does, in order. `seq` counts every event, so a log of events is a complete, ordered record.
export type BusEvent =
	| { seq: number; time: string; type: "sent"; message: AgentMessage }
	| {
			seq: number;
			time: string;
			type: "rejected";
			from: string;
			reason: string;
	  };

export type Bus = {
	// Checks `message` and puts a copy in its recipient's inbox. Throws if it's invalid, spoofed, or misaddressed.
	send: (from: string, message: AgentMessage) => void;
	// Everything waiting for `agentId`, oldest first; the inbox is emptied.
	receive: (agentId: string) => AgentMessage[];
	// Calls `listener` with every event from now on; returns a function that stops it.
	subscribe: (listener: (event: BusEvent) => void) => () => void;
	// How many messages are delivered but not yet received, across all inboxes.
	waiting: () => number;
};

// A message the bus refused; always a bug in the sending code.
export class BusError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BusError";
	}
}

// The only channel between agents: they hand messages to the bus and never touch each other.
// It validates every message, keeps one inbox per agent, and reports every event to subscribers.
export function createBus(agentIds: readonly string[]): Bus {
	const inboxes = new Map<string, AgentMessage[]>(
		agentIds.map((id) => [id, []]),
	);
	const listeners = new Set<(event: BusEvent) => void>();
	let seq = 0;

	const emit = (event: BusEvent) => {
		for (const listener of listeners) {
			listener(event);
		}
	};
	const reject = (from: string, reason: string): never => {
		emit({
			seq: ++seq,
			time: new Date().toISOString(),
			type: "rejected",
			from,
			reason,
		});
		throw new BusError(reason);
	};

	return {
		send: (from, message) => {
			const parsed = validate(message);
			if (typeof parsed === "string") {
				return reject(from, `invalid message from ${from}: ${parsed}`);
			}
			if (parsed.from !== from) {
				return reject(
					from,
					`${from} tried to send a message marked as from ${parsed.from}`,
				);
			}
			if (!inboxes.has(from)) {
				return reject(from, `unknown sender ${from}`);
			}
			const inbox = inboxes.get(parsed.to);
			if (!inbox) {
				return reject(from, `unknown recipient ${parsed.to}`);
			}
			if (parsed.to === from) {
				return reject(
					from,
					`${from} tried to send a message to itself`,
				);
			}
			// Separate copies for the inbox and the event, so a receiver changing its message
			// can't change what was logged, or the reverse.
			inbox.push(structuredClone(parsed));
			emit({
				seq: ++seq,
				time: new Date().toISOString(),
				type: "sent",
				message: structuredClone(parsed),
			});
		},
		receive: (agentId) => {
			const inbox = inboxes.get(agentId);
			if (!inbox) {
				throw new BusError(`unknown agent ${agentId}`);
			}
			return inbox.splice(0);
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		waiting: () =>
			[...inboxes.values()].reduce((sum, inbox) => sum + inbox.length, 0),
	};
}

// The message checked against its schema, or a description of the first problem.
// Shares have `kind: "share"`, responses carry a `decision`, and anything else must be a proposal.
function validate(message: unknown): AgentMessage | string {
	const object = typeof message === "object" && message !== null;
	const result =
		object && "kind" in message && message.kind === "share"
			? Share.safeParse(message)
			: object && "decision" in message
				? ProposalResponse.safeParse(message)
				: Proposal.safeParse(message);
	if (result.success) {
		return result.data;
	}
	const issue = result.error.issues[0];
	return `${issue?.path.join(".") || "(root)"}: ${issue?.message}`;
}
