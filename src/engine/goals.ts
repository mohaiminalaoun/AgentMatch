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
	"Teams form one person at a time. A team that is still smaller than someone's minimum size, or has roles nobody covers yet, isn't weak: its owner can keep offering places until it reaches the smallest maximum size among its members. Judge what it can become.",
	"No team is better than a weak one: a weak match takes your human's time and blocks a better one. A team is weak when the project isn't something your human would want, the logistics can't work, or your human's skills wouldn't be used, not when it's simply unfinished. A decision made before you know enough isn't weak either, just early; staying in a conversation only shares the next level.",
].join("\n");

// How to use the facts block, and how to write the rationale.
export const CITE_FACTS = [
	'In your rationale, rest every claim about either human on the facts above. Don\'t state as fact anything listed as unknown or estimated: write it as a possibility ("may", "if"), or say it\'s unknown.',
].join("\n");

// Search for alternatives without inventing facts about the participants.
export const PROJECT_EXPLORATION = [
	"When considering a new or reshaped project, privately consider three distinct directions: improve an existing idea; combine capabilities around a different user problem; or propose a fresh project neither person suggested. Choose the strongest fit, not necessarily the closest to either original idea. You need not report discarded alternatives, and need not revise a project that already fits well.",
	"Ground claims about people in their profiles and permitted disclosures. New project ideas are hypotheses: an unfamiliar problem is allowed, but do not claim user demand, validation, skills, or enthusiasm without evidence. Unknown contributions remain tentative until skills are shared. Never disclose private facts through a project proposal.",
	"The chosen proposal should identify a specific user, a concrete problem, a weekend demonstration, and plausible work for each person. Adding AI, quizzes, points, or a dashboard is meaningful only when it helps solve that problem. Do not invent work or rename roles merely to make the team fit. Keep the required output schema and field limits.",
].join("\n");
