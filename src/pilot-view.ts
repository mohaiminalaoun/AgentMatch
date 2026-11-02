// Entry point for `npm run pilot:view -- <log> <id> [people-dir]`: prints one person's own view of a pilot
// run as a timeline: the public board, their agent's every step with its private reasoning, the messages sent
// to or from them, and their own standing instructions (from the person file), never anyone else's.
import { formatEvent } from "./describe.js";
import { readRunLog } from "./engine/runlog.js";
import { loadPeople } from "./pilot/people.js";
import { eventsFor } from "./pilot/view.js";

try {
	const [path, id, peopleDir = "profiles"] = process.argv.slice(2);
	if (!path || !id) {
		throw new Error("Usage: npm run pilot:view -- <log> <id> [people-dir]");
	}
	const events = readRunLog(path);
	const known = events.some(
		(e) => e.type === "round" && e.agents.includes(id),
	);
	if (!known) {
		throw new Error(`${id} didn't take part in ${path}`);
	}
	const view = eventsFor(id, events);
	console.log(`${id}'s view of ${path} · ${view.length} events\n`);
	// Their own standing guidance, loaded from the person file. A missing dir must never block the log.
	let ownGuidance: string | undefined;
	try {
		ownGuidance = loadPeople(peopleDir).find(
			(p) => p.profile.id === id,
		)?.instructions;
	} catch {
		ownGuidance = undefined;
	}
	if (ownGuidance) {
		console.log(`Standing guidance: ${ownGuidance}\n`);
	}
	for (const event of view) {
		// Only their own steps have reasoning to show; everyone else's was left out, not empty.
		const own = "agent" in event && event.agent === id;
		const line = formatEvent(event, { rationale: own });
		if (line !== undefined) {
			console.log(line);
		}
	}
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
