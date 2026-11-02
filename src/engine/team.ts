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
	// The version of the project the members committed to: the owner's idea title, with the agreed pitch
	// as its description.
	project: ProjectIdea,
	// The roles that version needs from people other than the owner.
	rolesNeeded: z.array(z.string().min(1)),
	// Which of those roles each member other than the owner fills, as member id to role, worked out by code from
	// the skills each member shared. Someone who fills no role the team needs isn't listed. Missing in older logs.
	roles: z.record(z.string(), z.string()).optional(),
	status: TeamStatus,
});

export type Team = z.infer<typeof Team>;
