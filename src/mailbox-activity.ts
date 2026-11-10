// Reads an outside agent's trail at the mailbox (what `npm run mailbox -- activity <agent>` prints): when it
// called, what each call returned, and the two things that explain a quiet stretch in a run. Pure: no I/O.
import type { ActivityEntry } from "../mailbox/api/_mailbox.js";

export type ActivitySummary = {
	// get_pending / pending reads, and answers sent.
	reads: number;
	answers: number;
	// Requests a read returned, and which of those never got an accepted answer.
	seen: string[];
	seenNeverAnswered: {
		request: string;
		kind: string | undefined;
		firstSeen: string;
	}[];
	// The longest stretch between two calls, in seconds, and when it began.
	longestGap: { seconds: number; from: string } | undefined;
	firstCall: string | undefined;
	lastCall: string | undefined;
};

const ACCEPTED = new Set(["accepted", "duplicate"]);

// `entries` oldest first.
export function summarizeActivity(
	entries: readonly ActivityEntry[],
): ActivitySummary {
	const seen = new Map<
		string,
		{ kind: string | undefined; firstSeen: string }
	>();
	const answered = new Set<string>();
	let reads = 0;
	let answers = 0;
	let longestGap: ActivitySummary["longestGap"];
	let prev: ActivityEntry | undefined;
	for (const e of entries) {
		const isRead = e.tool === "get_pending" || e.tool === "pending";
		if (isRead) reads++;
		else answers++;
		if (isRead && e.request && !seen.has(e.request)) {
			seen.set(e.request, { kind: e.kind, firstSeen: e.at });
		}
		if (!isRead && e.request && ACCEPTED.has(e.result))
			answered.add(e.request);
		if (prev) {
			const seconds = Math.round(
				(new Date(e.at).getTime() - new Date(prev.at).getTime()) / 1000,
			);
			if (!longestGap || seconds > longestGap.seconds) {
				longestGap = { seconds, from: prev.at };
			}
		}
		prev = e;
	}
	return {
		reads,
		answers,
		seen: [...seen.keys()],
		seenNeverAnswered: [...seen.entries()]
			.filter(([id]) => !answered.has(id))
			.map(([request, v]) => ({
				request,
				kind: v.kind,
				firstSeen: v.firstSeen,
			})),
		longestGap,
		firstCall: entries[0]?.at,
		lastCall: entries.at(-1)?.at,
	};
}

const clock = (iso: string) => iso.slice(11, 19);

// One line per entry, oldest first.
export function describeEntry(e: ActivityEntry): string {
	const what =
		e.tool === "get_pending" || e.tool === "pending"
			? e.request
				? `returned ${e.kind ?? "request"} ${e.request}`
				: `nothing waiting${e.waited !== undefined ? ` (waited ${e.waited}s)` : ""}`
			: `${e.result}${e.request ? ` ${e.request}` : ""}`;
	return `${clock(e.at)}  ${e.via.padEnd(4)} ${e.tool.padEnd(13)} ${what}`;
}

export function describeSummary(s: ActivitySummary): string[] {
	const lines = [
		`${s.reads} reads, ${s.answers} answers sent · first call ${s.firstCall ? clock(s.firstCall) : "-"}, last ${s.lastCall ? clock(s.lastCall) : "-"} (UTC)`,
	];
	if (s.longestGap) {
		lines.push(
			`longest gap between calls: ${s.longestGap.seconds}s, starting ${clock(s.longestGap.from)}`,
		);
	}
	lines.push(
		s.seenNeverAnswered.length === 0
			? `every request it saw (${s.seen.length}) got an accepted answer`
			: `saw ${s.seen.length} requests; never answered in time: ${s.seenNeverAnswered.map((r) => `${r.kind ?? "?"} ${r.request} (first seen ${clock(r.firstSeen)})`).join("; ")}`,
	);
	return lines;
}
