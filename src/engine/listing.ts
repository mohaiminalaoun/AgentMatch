import { z } from "zod";
import { aboutHuman } from "./notes.js";
import type { AgentState } from "./agent.js";
import type { LlmClient } from "./client.js";
import { exchangeEvent, type RunEvent } from "./events.js";
import { checkDisclosure, draftOf } from "./gate.js";
import {
	StructuredOutputError,
	type ChatOptions,
	type Exchange,
	type Message,
} from "./llm.js";
import { ROLES } from "./profile.js";
import { Terms } from "./proposal.js";
import { publicPitch, type World } from "./round.js";

// What the model returns: private reasoning, then the public listing.
export const AgentListing = Terms.extend({ rationale: z.string().min(1) });

export type AgentListing = z.infer<typeof AgentListing>;

// The prompt asking `agent` to write its public board listing from its project idea.
export function listingMessages(agent: AgentState): Message[] {
	return [
		{
			role: "system",
			content: [
				"You are an AI agent forming hackathon teams on behalf of one person, your human.",
				aboutHuman(agent, 0),
				[
					"Write your human's listing for the public board, which everyone sees before any conversation:",
					"- pitch: one line about their project idea. You may sharpen the wording, but mention nothing beyond the project idea: not their skills, interests, availability, preferences, or name.",
					`- rolesNeeded: the roles the project needs teammates to fill, from: ${ROLES.join(", ")}. Think about what this project actually needs (an AI app needs ml; a data dashboard needs data). List only roles others would fill, never one your human would fill. Usually 2 to 4.`,
					"Your rationale is private.",
				].join("\n"),
			].join("\n\n"),
		},
		{ role: "user", content: "Write the listing." },
	];
}

// Every agent with a project idea has its model write its board listing, all at once. Each listing passes
// the disclosure gate at level 0 (nothing beyond the project idea, no own skills in the roles) and uses
// only known roles, or the model redrafts. If no valid listing comes back, the agent keeps the built-in
// pitch. Returns a new world with listings set; agents without a project idea are unchanged.
export async function writeListings(
	client: LlmClient,
	world: World,
	{
		onExchange,
		onEvent,
	}: {
		onExchange?: ChatOptions["onExchange"];
		onEvent?: (event: RunEvent) => void;
	} = {},
): Promise<World> {
	const known = new Set<string>(ROLES);
	const llmOptions = {
		onExchange: (exchange: Exchange) => {
			onExchange?.(exchange);
			onEvent?.(exchangeEvent(exchange));
		},
	};
	const writers = Object.values(world.agents)
		.filter((agent) => agent.profile.projectIdeas.length > 0)
		.sort((a, b) => (a.id < b.id ? -1 : 1));

	const written = await Promise.all(
		writers.map(async (agent): Promise<AgentState> => {
			let gateBlocks = 0;
			try {
				const { data } = await client.chatJson(
					listingMessages(agent),
					AgentListing,
					{
						...llmOptions,
						check: ({ pitch, rolesNeeded }) => {
							const leaks = checkDisclosure(
								agent.profile,
								0,
								draftOf({ pitch, rolesNeeded }),
							);
							if (leaks.length > 0) {
								gateBlocks++;
							}
							return [
								...leaks.map(
									(v) =>
										`your ${v.where === "roles" ? "roles needed list" : v.where} mentions "${v.match}" (${v.field}), which isn't public; leave it out`,
								),
								...rolesNeeded
									.filter((role) => !known.has(role))
									.map(
										(role) =>
											`"${role}" isn't a known role; use only: ${ROLES.join(", ")}`,
									),
							];
						},
					},
				);
				const listing = {
					pitch: data.pitch,
					rolesNeeded: [...new Set(data.rolesNeeded)],
				};
				onEvent?.({
					type: "listing",
					agent: agent.id,
					...listing,
					rationale: data.rationale,
					gateBlocks,
					fellBack: false,
				});
				return { ...agent, listing };
			} catch (error) {
				if (!(error instanceof StructuredOutputError)) {
					throw error;
				}
				const fallback = publicPitch(agent)!;
				onEvent?.({
					type: "listing",
					agent: agent.id,
					...fallback,
					rationale: undefined,
					gateBlocks,
					fellBack: true,
				});
				return agent;
			}
		}),
	);

	return {
		...world,
		agents: {
			...world.agents,
			...Object.fromEntries(written.map((agent) => [agent.id, agent])),
		},
	};
}
