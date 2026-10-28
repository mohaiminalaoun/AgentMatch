import { z } from "zod";
import { ProjectIdea } from "./profile.js";

// Tentative teams can still change; committed ones are binding.
export const TeamStatus = z.enum(["tentative", "committed"]);

export const Team = z.object({
	id: z.string().min(1),
	// Profile ids of the members. The first is the project's owner, whose idea the team builds.
	members: z
		.array(z.string().min(1))
		.min(2)
		.refine((ids) => new Set(ids).size === ids.length, {
			message: "members must be unique",
		}),
	project: ProjectIdea,
	status: TeamStatus,
});

export type Team = z.infer<typeof Team>;
