// Plain-language descriptions of bus messages and run events, shared by the live scripts and show-run
// so a run reads the same live and replayed.
import type { AgentMessage } from "./engine/agent.js";
import type { RunEvent } from "./engine/events.js";
import { formatExchange } from "./engine/llm.js";
import type { SimulationSummary } from "./engine/simulation.js";
import { estimateCost, type Prices } from "./engine/cost.js";

// One line describing `message`, without its sender and recipient.
export function describeMessage(message: AgentMessage): string {
	if ("kind" in message) {
		switch (message.kind) {
			case "share":
				return `share (level ${message.level}): ${JSON.stringify(message.shared)}`;
			case "interest":
				return `interest (level ${message.level}): ${message.interest}`;
			case "offer":
				return `offer: a place on ${message.team}`;
			case "answer":
				return `${message.answer} (${message.team})`;
			case "leave":
				return `leave (${message.team})`;
		}
	}
	if ("decision" in message) {
		const pitch = "pitch" in message ? `: "${message.pitch}"` : "";
		const reason = "reason" in message ? `: "${message.reason}"` : "";
		return `${message.decision}${pitch}${reason}`;
	}
	return `proposal: "${message.pitch}"  roles needed: ${message.rolesNeeded.join(", ")}`;
}

// One event as a timeline line, or undefined for model calls, which are summarized separately. Without
// `rationale`, agents' private reasoning is left out, for a shorter live view.
export function formatEvent(
	event: RunEvent,
	{ rationale = true }: { rationale?: boolean } = {},
): string | undefined {
	const reasoning = (text: string | undefined) =>
		rationale ? ` · private: ${text ?? "(none)"}` : "";
	switch (event.type) {
		case "round":
			return `round · ${event.time} · ${event.model} · agents: ${event.agents.join(", ")}`;
		case "listing":
			return `  ${event.agent} lists: "${event.pitch}" · needs ${event.rolesNeeded.join(", ")}${event.gateBlocks > 0 ? ` (gate blocked ${event.gateBlocks})` : ""}${event.fellBack ? " (fell back to the built-in pitch)" : ""}${reasoning(event.rationale)}`;
		case "discovery":
			return `  ${event.agent} chooses to approach: ${event.approach.join(", ") || "nobody"}${event.fellBack ? " (fell back)" : ""}${reasoning(event.rationale)}`;
		case "tick":
			return `\n── tick ${event.n} ──`;
		case "bus": {
			const e = event.event;
			return e.type === "sent"
				? `  #${e.seq} ${e.message.from} → ${e.message.to}   ${describeMessage(e.message)}`
				: `  #${e.seq} ✗ rejected: ${e.reason}`;
		}
		case "decision": {
			const notes = [
				...(event.gateBlocks > 0
					? [`gate blocked ${event.gateBlocks}`]
					: []),
				...(event.fellBack ? ["fell back to a plain decline"] : []),
			];
			return `     ${event.agent} decides ${event.decision.decision}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}${reasoning(event.rationale)}`;
		}
		case "interest":
			return `     ${event.agent} at level ${event.level} with ${event.other}: ${event.interest}${event.fellBack ? " (fell back)" : ""}${reasoning(event.rationale)}`;
		case "level":
			return `     level: ${event.agent} with ${event.other}  ${event.from} → ${event.to}`;
		case "offers":
			return `  ${event.agent} offers a place to: ${event.to.join(", ") || "nobody"} (${event.places} left)${event.fellBack ? " (fell back)" : ""}${event.rationale === undefined ? "" : reasoning(event.rationale)}`;
		case "commitment":
			return `  ${event.agent} holds offers from ${event.offers.join(", ")} → ${event.chose ? `commits to ${event.chose}'s team` : event.busy ? "busy with its own offers" : "declines them all"}${event.fellBack ? " (fell back)" : ""}${reasoning(event.rationale)}`;
		case "recheck":
			return `  ${event.agent} rechecks ${event.team} after it grew → ${event.decision}${event.fellBack ? " (fell back)" : ""}${reasoning(event.rationale)}`;
		case "team":
			return `  team ${event.team.id}: ${event.team.members.join(", ")} (${event.team.status}) · project: ${event.team.project.title}`;
		case "exchange":
			return undefined;
	}
}

// A whole run as a readable timeline, ending with a summary of model calls. With `prompts`, every
// model call is printed in full where it happened.
export function formatRun(
	events: readonly RunEvent[],
	{ prompts = false }: { prompts?: boolean } = {},
): string {
	const lines: string[] = [];
	let calls = 0;
	let tokens = 0;
	for (const event of events) {
		if (event.type === "exchange") {
			calls++;
			tokens += event.usage?.total ?? 0;
			if (prompts) {
				lines.push(
					`\n═══ model call ${calls} · ${event.time} ═══\n${formatExchange({ messages: event.messages, reply: event.reply, usage: event.usage })}\n`,
				);
			}
			continue;
		}
		const line = formatEvent(event);
		if (line !== undefined) {
			lines.push(line);
		}
	}
	lines.push(`\n${calls} model calls · ${tokens} tokens`);
	return lines.join("\n");
}

// A simulation's summary as the end-of-run report.
export function formatSummary(
	summary: SimulationSummary,
	prices?: Prices,
): string {
	const roles = Object.entries(summary.nonCoreRoles)
		.map(([role, n]) => `${role} ×${n}`)
		.join(", ");
	const reachedAt = (level: number) =>
		summary.pairs.filter((p) => p.level >= level).length;
	const list = (ids: string[]) =>
		ids.length > 0 ? `${ids.length} (${ids.join(", ")})` : "0";
	return [
		`Board:    ${summary.listings} listings · ${summary.seekers} looking to join · roles beyond the core four: ${roles || "none"}`,
		...summary.rounds.map(
			(r) =>
				`Round ${r.round}:  ${r.picks} picks → ${r.proposals} proposals · ${r.offers} offers → ${r.commits} commits`,
		),
		`Pairs:    ${summary.pairs.length} talked · reached level 1: ${reachedAt(1)} · level 2: ${reachedAt(2)} · ready: ${summary.pairs.filter((p) => p.ready).length} · ended: ${summary.pairs.filter((p) => p.ended).length}`,
		`Teams:    ${summary.teams.length} committed${summary.teams.map((t) => ` · ${t.members.join(" + ")}`).join("")} · members who left: ${summary.departures}`,
		...summary.teamChecks.map(
			(t) =>
				`  ${t.team}: covers ${t.covered.join(", ") || "nothing"} · missing ${t.missing.join(", ") || "nothing"}${t.belowMinimum ? " · below a member's minimum size" : ""}`,
		),
		`On no team:         ${list(summary.unplaced)}`,
		`Never approached:   ${list(summary.neverApproached)}`,
		`In no conversation: ${list(summary.noConversation)}`,
		`Gate blocks: ${summary.gateBlocks} · fallbacks: ${summary.fallbacks} · model calls: ${summary.calls}`,
		`Tokens: ${summary.usage.total} (input ${summary.usage.input}, output ${summary.usage.output}, of which hidden reasoning ${summary.usage.reasoning ?? 0}; cached input ${summary.usage.cached ?? 0})`,
		prices
			? `Estimated cost: $${estimateCost(summary.usage, prices).toFixed(2)}`
			: "Estimated cost: set LLM_PRICE_INPUT and LLM_PRICE_OUTPUT in .env to see it",
		`Ready pairs: ${
			summary.pairs
				.filter((p) => p.ready)
				.map((p) => p.pair.join("–"))
				.join(", ") || "none"
		}`,
	].join("\n");
}
