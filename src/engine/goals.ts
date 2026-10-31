// What a good team is for an agent's human, said once and given word for word to every decision, so the calls
// along the way (whom to approach, accept, continue, adopt, offer, commit) judge by the same standard instead of
// each prompt carrying its own rule of thumb.

// The standard every decision judges by.
export const GOOD_TEAM = [
	"A good team for your human is one where, weighed together:",
	"- the project is something your human would want to build;",
	"- their interests overlap in meaning (similar topics count, not just identical words);",
	"- the logistics work going by the facts: time zones and weekly hours that leave room to collaborate, and a team size that suits everyone;",
	"- every role the project needs has someone who can do it and has the time for it, your human included;",
	"- your human gets to use skills they're good at.",
	"No match is perfect: weigh these against each other, and against the other options your human actually has.",
	"Teams form one person at a time. A team that is still smaller than someone's minimum size, or has roles nobody covers yet, isn't weak: its owner can keep offering places until it reaches the smallest maximum size among its members. Judge what it can become.",
	"No team is better than a weak one: a weak match takes your human's time and blocks a better one. A team is weak when the project isn't something your human would want, the logistics can't work, or your human's skills wouldn't be used, not when it's simply unfinished. A decision made before you know enough isn't weak either, just early; staying in a conversation only shares the next level.",
].join("\n");

// How to use the facts block, and how to write the rationale.
export const CITE_FACTS = [
	'In your rationale, rest every claim about either human on the facts above. Don\'t state as fact anything listed as unknown or estimated: write it as a possibility ("may", "if"), or say it\'s unknown.',
].join("\n");
