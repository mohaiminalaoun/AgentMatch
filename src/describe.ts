// Plain-language descriptions of bus messages, for the live scripts' output.
import type { AgentMessage } from "./engine/agent.js";

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
