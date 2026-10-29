// Entry point for `npm run pilot:view -- <log> <id>`: prints one person's own view of a pilot run as a
// timeline: the public board, their agent's every step with its private reasoning, and the messages sent to or
// from them, never anyone else's. What to show that person, and only them.
import { formatEvent } from "./describe.js";
import { readRunLog } from "./engine/runlog.js";
import { eventsFor } from "./pilot/view.js";

try {
	const [path, id] = process.argv.slice(2);
	if (!path || !id) {
		throw new Error("Usage: npm run pilot:view -- <log> <id>");
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
