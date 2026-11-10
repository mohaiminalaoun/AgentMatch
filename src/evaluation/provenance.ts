// Where each decision in a run came from, counted from the log alone (no schema change, so it also reads logs
// written before this existed):
// - "model": the shared model answered, and the answer was used.
// - "outside": an outside agent answered through the mailbox (agents named in the log's `brains` event).
// - "default": no valid answer came back, so the code sent its safe default (the event's `fellBack`). For an
//   outside agent that is mostly a missed deadline or an answer the engine kept rejecting.
// Overrides are counted apart, because they change what an answer did without replacing it: the disclosure gate
// stopping a draft the agent then rewrote, code dropping people the model chose to offer a place, and code making
// an uncited "never" steer neutral.
import type { RunEvent } from "../engine/events.js";

export type Source = "model" | "outside" | "default";

export type ProvenanceReport = {
	// Every decision event with a `fellBack` field: listings, choices, interest checks, offers, votes, and so on.
	decisions: number;
	bySource: Record<Source, number>;
	overrides: {
		// Decisions where the gate stopped at least one draft.
		gateBlocked: number;
		// Offer events where code dropped someone the model had ranked.
		offersDropped: number;
		// Hunches code made neutral because they cited no note.
		hunchesNeutralized: number;
	};
	// Outside-agent requests that ended on the engine's default, by why (from the mailbox diagnostics).
	outsideFallbacks: Record<string, number>;
};

// The agents answered by an outside agent, from the log's `brains` event ("mailbox:<name>").
function outsideAgents(events: readonly RunEvent[]): Set<string> {
	const ids = new Set<string>();
	for (const event of events) {
		if (event.type === "brains") {
			for (const [id, brain] of Object.entries(event.agents)) {
				if (brain.startsWith("mailbox:")) ids.add(id);
			}
		}
	}
	return ids;
}

export function decisionProvenance(
	events: readonly RunEvent[],
): ProvenanceReport {
	const outside = outsideAgents(events);
	const report: ProvenanceReport = {
		decisions: 0,
		bySource: { model: 0, outside: 0, default: 0 },
		overrides: { gateBlocked: 0, offersDropped: 0, hunchesNeutralized: 0 },
		outsideFallbacks: {},
	};
	for (const event of events) {
		if (event.type === "mailbox") {
			if (event.status === "fallback") {
				const why = event.reason ?? "unknown";
				report.outsideFallbacks[why] =
					(report.outsideFallbacks[why] ?? 0) + 1;
			}
			continue;
		}
		if (!("fellBack" in event) || !("agent" in event)) continue;
		report.decisions++;
		const source: Source = event.fellBack
			? "default"
			: outside.has(event.agent)
				? "outside"
				: "model";
		report.bySource[source]++;
		if ("gateBlocks" in event && (event.gateBlocks ?? 0) > 0) {
			report.overrides.gateBlocked++;
		}
		if (event.type === "offers" && (event.dropped?.length ?? 0) > 0) {
			report.overrides.offersDropped++;
		}
		if (event.type === "hunch" && event.unfounded) {
			report.overrides.hunchesNeutralized++;
		}
	}
	return report;
}

// One line for a report: the share by source, then the overrides.
export function describeProvenance(r: ProvenanceReport): string {
	if (r.decisions === 0) return "no decisions logged";
	const pct = (n: number) => `${Math.round((n / r.decisions) * 100)}%`;
	const parts = [
		`${r.decisions} decisions`,
		`model ${r.bySource.model} (${pct(r.bySource.model)})`,
		`outside ${r.bySource.outside} (${pct(r.bySource.outside)})`,
		`default ${r.bySource.default} (${pct(r.bySource.default)})`,
		`gate stopped ${r.overrides.gateBlocked}`,
		`offers trimmed ${r.overrides.offersDropped}`,
		`hunches neutralized ${r.overrides.hunchesNeutralized}`,
	];
	const fallbacks = Object.entries(r.outsideFallbacks);
	if (fallbacks.length > 0) {
		parts.push(
			`outside defaults: ${fallbacks.map(([why, n]) => `${why} ${n}`).join(", ")}`,
		);
	}
	return parts.join(" · ");
}
