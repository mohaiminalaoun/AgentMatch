// The `--outside <person>=<agent>` flags of `pilot:run`: which people's agents answer through the hosted mailbox,
// and as which mailbox agent. The flag may be given more than once, to put several outside agents (Muse and
// Grokbot, say) in one run, each answering for a different person. Pure, so the rules can be tested.

export type OutsideAgent = { person: string; agent: string };

// Grokbot is woken by webhook, so its answers are checked promptly without waiting on a polling loop.
export const WEBHOOK_AGENT = "grokbot";

const PAIR = /^(?<person>p-[a-z0-9]+)=(?<agent>[\w-]+)$/;

// Every `--outside` in `argv`, in order. Throws with a message fit to print.
export function parseOutsides(argv: readonly string[]): OutsideAgent[] {
	const found: OutsideAgent[] = [];
	argv.forEach((arg, i) => {
		if (arg !== "--outside") return;
		const groups = PAIR.exec(argv[i + 1] ?? "")?.groups;
		if (!groups) {
			throw new Error(
				"--outside needs a person id and a mailbox agent, like p-4k2m=muse",
			);
		}
		found.push({ person: groups.person!, agent: groups.agent! });
	});
	const seenPeople = new Set<string>();
	const seenAgents = new Set<string>();
	for (const { person, agent } of found) {
		if (seenPeople.has(person)) {
			throw new Error(
				`--outside: ${person} is given more than once; a person has one agent`,
			);
		}
		if (seenAgents.has(agent)) {
			throw new Error(
				`--outside: the mailbox agent ${agent} is given for more than one person; an outside agent answers for one person, because agents with the same name share one queue of requests`,
			);
		}
		seenPeople.add(person);
		seenAgents.add(agent);
	}
	return found;
}

// How often the arena checks the mailbox for `agent`'s answers: `override` (from --poll-seconds) for everyone if
// given, otherwise 2 seconds for the webhook agent and 15 for agents that poll.
export function pollSecondsFor(agent: string, override?: number): number {
	return override ?? (agent === WEBHOOK_AGENT ? 2 : 15);
}
