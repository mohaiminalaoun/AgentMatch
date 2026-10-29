import { z } from "zod";
import type { AgentState } from "./agent.js";
import { DisclosureLevel } from "./disclosure.js";

// Something a person tells their own agent that no form asks for: a past project and how it went, how they
// like to work, a long-tail interest. Each note has the lowest level at which the agent may draw on it in
// what it sends, or "never" for notes that only ever inform its private judgment.
export const Note = z.object({
	text: z.string().min(1),
	level: z.union([DisclosureLevel, z.literal("never")]),
});

export type Note = z.infer<typeof Note>;

// The notes allowed at `level`: at or below it, and never the "never" ones.
export function notesFor(
	notes: readonly Note[],
	level: DisclosureLevel,
): string[] {
	return notes
		.filter((note) => note.level !== "never" && note.level <= level)
		.map((note) => note.text);
}

// What a prompt tells the model about its own human at `level`. The full profile is always there: its values
// are short and known, so the gate can find them in anything sent. Notes are free text that a model could
// paraphrase past any check, so only the notes `level` allows are included: a note that isn't in the prompt
// can't leak.
export function aboutHuman(agent: AgentState, level: DisclosureLevel): string {
	const notes = notesFor(agent.notes, level);
	return [
		`Your human's full profile (private; for your judgment only):\n${JSON.stringify(agent.profile, null, 2)}`,
		...(notes.length > 0
			? [
					`Your human's own notes, which you may draw on at this level (use them to judge fit and shape ideas; describe ideas rather than quoting them):\n${notes.map((text) => `- ${text}`).join("\n")}`,
				]
			: []),
	].join("\n\n");
}
