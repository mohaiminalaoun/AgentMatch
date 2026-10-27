import type { Message } from "./llm.js";
import type { Proposal } from "./proposal.js";

// The prompt asking an agent to accept, counter, or decline `proposal` for the person described in `human`.
// A first draft: step 4.3 replaces the free-text `human` with their real profile.
export function decisionMessages(human: string, proposal: Proposal): Message[] {
	return [
		{
			role: "system",
			content: `You are an agent negotiating team formation on behalf of one person. ${human} Accept, counter, or decline proposals in their interest.`,
		},
		{
			role: "user",
			content: `You received this proposal:\nPitch: ${proposal.pitch}\nRoles needed: ${proposal.rolesNeeded.join(", ")}`,
		},
	];
}
