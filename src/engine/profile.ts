import { z } from "zod";

// Skills are named by role, so "who covers which role" is a simple lookup.
export const ROLES = [
	"frontend",
	"backend",
	"mobile",
	"ml",
	"data",
	"design",
	"devops",
	"product",
] as const;

// Roles most hackathon projects need. Other roles only matter for some projects.
export const CORE_ROLES = ["frontend", "backend", "design", "product"] as const;

export const SkillLevel = z.enum(["beginner", "intermediate", "expert"]);

export const Skill = z.object({
	name: z.string().min(1),
	level: SkillLevel,
});

export const ProjectIdea = z.object({
	title: z.string().min(1),
	description: z.string(),
});

export const Availability = z.object({
	hoursPerWeek: z.int().min(0).max(168),
	// Hours offset from UTC, e.g. -5 for New York in winter.
	utcOffset: z.number().min(-12).max(14),
});

export const Preferences = z
	.object({
		minTeamSize: z.int().min(1),
		maxTeamSize: z.int().min(1),
		preferredRoles: z.array(z.string().min(1)),
	})
	.refine((p) => p.minTeamSize <= p.maxTeamSize, {
		message: "minTeamSize must not exceed maxTeamSize",
		path: ["minTeamSize"],
	});

export const Profile = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	skills: z.array(Skill).min(1),
	interests: z.array(z.string().min(1)),
	projectIdeas: z.array(ProjectIdea),
	availability: Availability,
	preferences: Preferences,
});

export type Profile = z.infer<typeof Profile>;
