// Before a pilot with an outside agent that polls (Muse), check that it is actually listening: its newest call at
// the mailbox should be recent. An agent that is not listening would otherwise hold every request until its
// deadline, minutes each, before the run falls back to the safe default. The mailbox keeps a metadata-only trail of
// each agent's calls (`/engine/activity`); this reads the newest entry.
import type { ActivityEntry } from "../../mailbox/api/_mailbox.js";

// A listening worker calls every 20-25 seconds when nothing is waiting, so a minute without a call means it has
// stopped, not that it is between polls.
export const LISTEN_MAX_AGE_SECONDS = 60;

export type ListenCheck =
	| { state: "listening"; ageSeconds: number }
	// No call on record, or the newest is older than allowed.
	| {
			state: "stale";
			lastAt: string | undefined;
			ageSeconds: number | undefined;
	  }
	// The mailbox could not say (older deployment, wrong key, network trouble): not evidence either way.
	| { state: "unknown"; reason: string };

// `entries` newest first, as the mailbox returns them.
export function judgeListening(
	entries: readonly ActivityEntry[],
	nowMs: number,
	maxAgeSeconds = LISTEN_MAX_AGE_SECONDS,
): ListenCheck {
	const newest = entries[0];
	if (!newest) {
		return { state: "stale", lastAt: undefined, ageSeconds: undefined };
	}
	const ageSeconds = Math.max(
		0,
		Math.round((nowMs - new Date(newest.at).getTime()) / 1000),
	);
	return ageSeconds <= maxAgeSeconds
		? { state: "listening", ageSeconds }
		: { state: "stale", lastAt: newest.at, ageSeconds };
}

export async function checkListening(
	settings: { url: string; engineKey: string },
	agent: string,
	{
		fetch: fetchFn = fetch,
		now = () => Date.now(),
		maxAgeSeconds = LISTEN_MAX_AGE_SECONDS,
	}: {
		fetch?: typeof fetch;
		now?: () => number;
		maxAgeSeconds?: number;
	} = {},
): Promise<ListenCheck> {
	let response: Response;
	try {
		response = await fetchFn(new URL("/engine/activity", settings.url), {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(10_000),
			headers: {
				authorization: `Bearer ${settings.engineKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ agent, limit: 1 }),
		});
	} catch (error) {
		return {
			state: "unknown",
			reason: `could not reach the mailbox (${(error as Error).message})`,
		};
	}
	if (response.status === 404) {
		return {
			state: "unknown",
			reason: "the mailbox has no call trail (deployed before it was added?)",
		};
	}
	if (!response.ok) {
		return {
			state: "unknown",
			reason: `the mailbox answered ${response.status}`,
		};
	}
	let activity: unknown;
	try {
		activity = ((await response.json()) as { activity?: unknown }).activity;
	} catch {
		return {
			state: "unknown",
			reason: "the mailbox's answer was not JSON",
		};
	}
	if (!Array.isArray(activity)) {
		return {
			state: "unknown",
			reason: "the mailbox's answer had no activity list",
		};
	}
	return judgeListening(activity as ActivityEntry[], now(), maxAgeSeconds);
}

const clock = (iso: string) => iso.slice(11, 19);

// The line to print, and what to do about it.
export function describeListenCheck(agent: string, check: ListenCheck): string {
	switch (check.state) {
		case "listening":
			return `${agent} is listening (its last call at the mailbox was ${check.ageSeconds}s ago)`;
		case "stale":
			return [
				check.lastAt === undefined
					? `${agent} has made no calls at the mailbox, so it is not listening.`
					: `${agent} is not listening: its last call at the mailbox was ${check.ageSeconds}s ago (${clock(check.lastAt)} UTC).`,
				`Start it listening first (see docs/muse.md), or pass --skip-listen-check to run anyway. Requests it never answers hold the run until --answer-minutes passes.`,
			].join("\n");
		case "unknown":
			return `could not check whether ${agent} is listening: ${check.reason}. Continuing.`;
	}
}
