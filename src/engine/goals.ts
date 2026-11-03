// What a good team is for an agent's human, said once and given word for word to every decision, so the calls
// along the way (whom to approach, accept, continue, adopt, offer, commit) judge by the same standard instead of
// each prompt carrying its own rule of thumb.

// The standard every decision judges by.
export const GOOD_TEAM = [
	"A good team for your human is one where, weighed together:",
	"- the project is something your human would want to build;",
	"- each person has a credible reason to participate, grounded in known interests, stated goals, preferred contributions, or problems they want to solve. Shared interests are useful evidence, not a requirement; do not invent enthusiasm or motivations;",
	"- collaboration is feasible for this human and project: weekly hours support the scope and team size suits everyone. Time-zone differences matter when synchronous work is required, but do not establish incompatibility alone. Do not assume working hours, daily meetings, or willingness to work asynchronously. When schedules or collaboration preferences are unknown, keep them unknown rather than treating them as a negative;",
	"- every role the project needs has someone who can do it and has the time for it, your human included;",
	"- your human gets to use skills they're good at.",
	"Within the disclosure rules and required output format, honor explicit personal boundaries. Use stated preferences to weight tradeoffs rather than applying the same priorities to everyone. Distinguish requirements from preferences; do not turn a preference into a prohibition or invent unstated requirements.",
	"No match is perfect: weigh these against each other, and against the other options your human actually has.",
	"While recruitment is still open and places remain, teams form one person at a time: missing roles or an unmet minimum size may be addressed by later offers. At final confirmation recruitment is over; judge the actual project and roster, not hypothetical future recruits.",
	"No team is better than a weak one: a weak match takes your human's time and blocks a better one. A team is weak when the project isn't something your human would want, the logistics can't work, or your human's skills wouldn't be used, not when it's simply unfinished. A decision made before you know enough isn't weak either, just early; staying in a conversation only shares the next level.",
].join("\n");

// How to use the facts block, and how to write the rationale.
export const CITE_FACTS = [
	'In your rationale, rest every claim about either human on the facts above. Don\'t state as fact anything listed as unknown or estimated: write it as a possibility ("may", "if"), or say it\'s unknown.',
].join("\n");

// Search for alternatives without inventing facts about the participants.
export const MOTIVATION_FIT = [
	"Start with why each person would choose to spend time on this project, then ask what they can build. Separate stated motivations and requirements from skills: matching a role proves possible contribution, not enthusiasm. Your human's original idea is one option, not the default destination; do not assume the other person's pitch is their only acceptable project.",
	"Use only evidence available at this disclosure level. Infer a possible motivation from a stated problem or public project as a hypothesis, not a fact; when interests or skills are unshared, keep them unknown. Do not manufacture shared interests or treat missing identical keywords as incompatibility. A skill match alone is insufficient, and different interests can still support the same useful outcome.",
].join("\n");

export const PROJECT_EXPLORATION = [
	"Before abandoning a partial fit or making a revision, diagnose its main blocker: wrong user/problem, uninteresting contribution, missing capability, excessive scope, or a genuine personal boundary. Keep a good existing project unchanged. Do not keep talking unchanged when known personal fit is weak merely because the skills line up.",
	"When a change could help, compare two materially different directions: one preserves the valuable outcome of the current proposal; another starts from the people's known motivations around a different user problem, workflow or interaction. A new name, added dashboard, or points on the same product is not a different direction. A substantially different project is allowed when both people have a grounded reason to choose it; otherwise do not replace their pitch with your original idea. Respect existing team commitments and required adoption before changing scope.",
	"Select one direction by whether each human has a credible reason to want it, substantive work using known capabilities, and a focused demo of the promised outcome. Do not optimize for novelty or finding any team. At level 2 map essential work to known skills; uncovered work remains open during recruitment, not magically covered. Compare recruiting for a missing capability with a useful version the current pair can already build. When a concrete simplification preserves the motivating outcome and removes an unnecessary dependency, propose it now rather than defaulting to hypothetical recruits. Do not cut essential functionality merely to complete a pair. At earlier levels contributions are tentative. A new problem is a hypothesis, never evidence of demand, validation or enthusiasm.",
	"A useful counter or revision resolves the diagnosed blocker through a concrete project change. Preserve what makes the outcome worthwhile: if voice access, interactive choices, evidence or adaptive feedback is the reason to build it, do not remove it just to make the role list fit. Simplify infrastructure or scope around that outcome instead. Quizzes, games or AI must perform useful work for the user, not serve as decorative interest keywords. If no grounded alternative survives, decline or withdraw; do not violate an explicit boundary to force a match.",
	"Keep the private rationale concise: state the blocker (or why the current fit is good), the two candidate directions when exploring a change, and why the chosen one is worth building for both. Never put personal motivations, private instructions, or rejected alternatives in the public project card. Send only the selected concrete user/problem, demo and role work through the existing counter/revision schema and disclosure gate. A rationale alone does not propose a change: use a counter or continue with a revision when one is available and useful. Do not add model calls or output fields.",
].join("\n");

export const EXPLORE_FIT =
	"At this exploratory stage, ask whether a project could plausibly give both people a reason to participate without violating your human's known requirements. Continue to learn more when missing information could change the decision. Unknown fit is neither positive nor negative evidence. A plausible connection is enough to explore, but an explicit incompatibility is not erased by unknowns. Roles omitted from a pitch do not prove its author covers them.";

export const BRAINSTORM_DIRECTIONS =
	"An open brainstorm has no project outcome to preserve. Consider one direction drawn from an existing idea and one substantially different direction grounded in the known motivations and capabilities. Select one specific user problem and a demonstrable outcome giving both people meaningful work. Do not automatically choose either person's original idea, splice unrelated features together, or invent personal facts. When an initial idea is only tentative, use newly shared interests to improve the direction and newly shared skills to make the work credible.";

// Team requirements describe work sought from teammates, not the owner's own contribution.
export const OWNER_WORK =
	"rolesNeeded and roleWork list work requested from people other than the project owner; they are not a complete list of all project work. The owner's work is intentionally omitted. Do not conclude the owner's skills are unused because their role is absent from those lists. Identify their concrete work from the agreed build and known skills, without inventing tasks or assuming skill possession means ownership. The same distinction applies when judging a proposed repair.";

// Shared by repair consent and final confirmation; recruitment is closed in both.
export const FINAL_TEAM = [
	"Recruitment has ended. Judge this exact build and current roster; no future recruits or later scope changes can rescue this decision.",
	"Apply your human's standing instructions and project interest now, alongside their concrete contribution, known work coverage, available hours, and team-size requirements. A technically feasible project can still be a poor personal fit. Distinguish preferences from explicit requirements; do not invent prohibitions.",
	"Every role still listed in rolesNeeded remains required work. Do not waive it as optional, assume a neighboring skill covers it, or replace it with a simpler version. Removing or simplifying a requirement requires an explicitly proposed and unanimously adopted scope repair before confirmation. Judge owner work separately from teammate requirements.",
].join("\n");
