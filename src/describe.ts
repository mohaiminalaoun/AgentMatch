// Plain-language descriptions of bus messages and run events, shared by the live scripts and show-run
// so a run reads the same live and replayed.
import type { AgentMessage } from "./engine/agent.js";
import type { RunEvent } from "./engine/events.js";
import { formatExchange } from "./engine/llm.js";

// One line describing `message`, without its sender and recipient.
export function describeMessage(message: AgentMessage): string {
	if ("kind" in message) {
		return message.kind === "share"
			? `share (level ${message.level}): ${JSON.stringify(message.shared)}`
			: `interest (level ${message.level}): ${message.interest}`;
	}
	if ("decision" in message) {
		const pitch = "pitch" in message ? `: "${message.pitch}"` : "";
		const reason = "reason" in message ? `: "${message.reason}"` : "";
		return `${message.decision}${pitch}${reason}`;
	}
	return `proposal: "${message.pitch}"  roles needed: ${message.rolesNeeded.join(", ")}`;
}

// One event as a timeline line, or undefined for model calls, which are summarized separately.
export function formatEvent(event: RunEvent): string | undefined {
	switch (event.type) {
		case "round":
			return `round · ${event.time} · ${event.model} · agents: ${event.agents.join(", ")}`;
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
			return `     ${event.agent} decides ${event.decision.decision}${notes.length > 0 ? ` (${notes.join(", ")})` : ""} · private: ${event.rationale ?? "(none)"}`;
		}
		case "interest":
			return `     ${event.agent} at level ${event.level} with ${event.other}: ${event.interest}${event.fellBack ? " (fell back)" : ""} · private: ${event.rationale ?? "(none)"}`;
		case "level":
			return `     level: ${event.agent} with ${event.other}  ${event.from} → ${event.to}`;
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
