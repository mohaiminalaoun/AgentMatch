import type { RunEvent } from "../engine/events.js";

// What one person may see of a run: the public board, their own agent's every step with its private
// reasoning, and the messages sent to or from them. Never a model call (those hold whole prompts), and
// nothing private to anyone else: their reasoning, their picks, or conversations they weren't part of.
export function eventsFor(id: string, events: readonly RunEvent[]): RunEvent[] {
	// Teams this person has been on, so a team they later leave or lose stays in their view.
	const theirTeams = new Set<string>();
	return events.flatMap((event): RunEvent[] => {
		switch (event.type) {
			case "round":
			case "tick":
			case "stopped":
				return [event];
			// Every listing is public, but only its pitch and roles.
			case "listing": {
				if (event.agent === id) {
					return [event];
				}
				const { rationale: _, ...listing } = event;
				return [listing];
			}
			case "bus":
				return (event.event.type === "sent" &&
					(event.event.message.from === id ||
						event.event.message.to === id)) ||
					(event.event.type === "rejected" && event.event.from === id)
					? [event]
					: [];
			case "team":
				if (event.team.members.includes(id)) {
					theirTeams.add(event.team.id);
				}
				return theirTeams.has(event.team.id) ? [event] : [];
			// Who else was left without a team isn't theirs to know.
			case "brainstorm":
				return event.agents.includes(id)
					? [{ ...event, agents: [id] }]
					: [];
			case "exchange":
				return [];
			// Decisions, discovery, interest checks, hunches, revision answers, levels, offers, commitments, and
			// rechecks: each is one agent's own step, with its private reasoning.
			default:
				return event.agent === id ? [event] : [];
		}
	});
}
