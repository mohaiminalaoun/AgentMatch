// A fixed cast of 30 people for live runs that a person reads and judges, such as sessions with an outside
// agent. Unlike `generateProfiles`, which draws everything at random for statistics, each person here starts
// from one real idea, and the rest follows from it: their skills are what the project needs its author to do,
// their interests fit it, and `needs` names the roles they can't cover. That makes it possible to say in
// advance which matches should happen (`EXPECTED_GROUPS`) and check whether the arena finds them.
//
// The ideas are paraphrased from project intros posted in the Meta Global AI Developer Hackathon's Discord
// (#intros and #push-the-frontier, Oct 26–27, 2026). Titles and descriptions are our own words; nobody who
// posted is named. Names, hours, time zones, and team sizes are made up, varied so logistics still matter.
import { Profile, type ROLES } from "../engine/profile.js";

type Role = (typeof ROLES)[number];

export const CLUSTERS = [
	"agent safety",
	"developer tools",
	"health",
	"agriculture and civic",
	"education",
	"small business",
	"media and games",
] as const;
export type Cluster = (typeof CLUSTERS)[number];

// What a project card shows at level 0, beyond the title and pitch (step 4): the problem and who has it,
// what a weekend build would include, and what each role the author needs would do.
export type CardDetails = {
	problem: string;
	build: string;
	roleWork: Partial<Record<Role, string>>;
};

export type CastMember = {
	profile: Profile;
	cluster: Cluster;
	// The roles the project needs from others: the ones its author can't cover.
	needs: Role[];
	card: CardDetails;
};

type Seed = {
	name: string;
	cluster: Cluster;
	title: string;
	pitch: string;
	skills: [Role, "beginner" | "intermediate" | "expert"][];
	interests: string[];
	hours: number;
	utc: number;
	team: [number, number];
	card: CardDetails;
};

// Ordered round-robin across clusters, so the first N of the cast always mixes them (`castProfiles`).
const SEEDS: Seed[] = [
	{
		name: "Ada",
		cluster: "agent safety",
		title: "Agent action firewall",
		pitch: "A proxy between AI agents and their tools that checks every tool call against policy and risk, and blocks the unsafe ones.",
		skills: [
			["backend", "expert"],
			["devops", "intermediate"],
		],
		interests: ["AI agents", "security", "open source"],
		hours: 15,
		utc: 1,
		team: [2, 3],
		card: {
			problem:
				"Teams giving agents real tools can't see or stop a dangerous call before it runs.",
			build: "A proxy in front of a few common tools, a policy file, and a live log of allowed and blocked calls.",
			roleWork: {
				frontend:
					"a dashboard to write policies and review blocked calls",
			},
		},
	},
	{
		name: "Ben",
		cluster: "developer tools",
		title: "UI bug finder",
		pitch: "Finds visual UI bugs in screen recordings of an app, for teams testing apps where there's no DOM to inspect.",
		skills: [
			["ml", "expert"],
			["frontend", "intermediate"],
		],
		interests: ["developer tools", "AI agents"],
		hours: 20,
		utc: -5,
		team: [2, 4],
		card: {
			problem:
				"Native and canvas apps have no DOM, so UI bugs only show up when someone watches a recording.",
			build: "Upload a recording, get a list of suspected bugs with timestamps and frames.",
			roleWork: {
				backend:
					"a service that splits recordings into frames and queues them for the model",
			},
		},
	},
	{
		name: "Chen",
		cluster: "health",
		title: "Blood smear assistant",
		pitch: "Segments the cells in a blood smear image, classifies them, and drafts a cell count for a lab technician to review.",
		skills: [
			["ml", "expert"],
			["data", "intermediate"],
		],
		interests: ["health", "research"],
		hours: 12,
		utc: 8,
		team: [2, 3],
		card: {
			problem:
				"Manual smear review is slow, and small labs have few technicians.",
			build: "Upload a smear image, see segmented cells with labels, and a draft count to accept or correct.",
			roleWork: {
				frontend: "a review screen to accept or relabel each cell",
				backend: "image upload, storage, and a review history",
			},
		},
	},
	{
		name: "Dara",
		cluster: "agriculture and civic",
		title: "Flood alerts from satellites",
		pitch: "Maps flooding from satellite imagery and sends local alerts in English and Swahili.",
		skills: [
			["data", "expert"],
			["ml", "intermediate"],
		],
		interests: ["climate", "civic tech"],
		hours: 18,
		utc: 3,
		team: [2, 4],
		card: {
			problem:
				"Communities hear about floods too late, and alerts rarely come in their language.",
			build: "A flood map for one region from recent imagery, and SMS-style alerts for affected areas.",
			roleWork: {
				frontend: "the public flood map",
				backend: "subscriptions and alert sending",
			},
		},
	},
	{
		name: "Eli",
		cluster: "education",
		title: "Physics step checker",
		pitch: "Finds the wrong step in a photo of handwritten physics working and explains it in English or Urdu.",
		skills: [["ml", "expert"]],
		interests: ["education", "accessibility"],
		hours: 10,
		utc: 5,
		team: [2, 3],
		card: {
			problem:
				"Students get a wrong answer back with no idea which step went wrong.",
			build: "Take a photo of working, see each step read back, with the first wrong one highlighted and explained.",
			roleWork: {
				mobile: "the camera app students use",
				frontend: "a teacher view of common mistakes",
			},
		},
	},
	{
		name: "Farah",
		cluster: "small business",
		title: "WhatsApp salon assistant",
		pitch: "A WhatsApp agent that books appointments for small salons and keeps a simple ledger from chats and voice notes.",
		skills: [["backend", "expert"]],
		interests: ["small business", "finance"],
		hours: 25,
		utc: 1,
		team: [2, 3],
		card: {
			problem:
				"Small salons run bookings and money through WhatsApp chats that nobody can search.",
			build: "A WhatsApp number that books slots and logs payments, plus a weekly summary for the owner.",
			roleWork: {
				frontend: "the owner's dashboard of bookings and income",
				product: "talking to two salon owners and shaping the flows",
			},
		},
	},
	{
		name: "Gus",
		cluster: "media and games",
		title: "Crisis press conference sim",
		pitch: "Practice a crisis press conference with AI reporters who interrupt, follow up, and twist your words.",
		skills: [
			["product", "expert"],
			["design", "intermediate"],
		],
		interests: ["gaming", "media"],
		hours: 8,
		utc: -8,
		team: [3, 4],
		card: {
			problem:
				"Spokespeople rarely get to rehearse hostile questions before a real crisis.",
			build: "A voice session with three reporter personas and a scorecard at the end.",
			roleWork: {
				backend: "the voice session and turn-taking between reporters",
				ml: "reporter personas that follow up on weak answers",
			},
		},
	},
	{
		name: "Hana",
		cluster: "agent safety",
		title: "Done-checker for agents",
		pitch: "Checks whether a computer-use agent's claim that a task is done matches what's actually on the screen.",
		skills: [
			["ml", "expert"],
			["backend", "intermediate"],
		],
		interests: ["AI agents", "developer tools"],
		hours: 20,
		utc: 9,
		team: [2, 3],
		card: {
			problem:
				"Computer-use agents report success on tasks they didn't finish.",
			build: "Given a task and the agent's final screenshots, a verdict with the evidence for it.",
			roleWork: {
				frontend:
					"a viewer that shows the task, the claim, and the evidence side by side",
			},
		},
	},
	{
		name: "Ivan",
		cluster: "developer tools",
		title: "Requirement to tested",
		pitch: "Turns a plain-language requirement into a test plan, runs it in a real browser, and keeps the evidence.",
		skills: [
			["frontend", "expert"],
			["product", "intermediate"],
		],
		interests: ["developer tools", "open source"],
		hours: 15,
		utc: 0,
		team: [2, 4],
		card: {
			problem:
				"Requirements and tests drift apart, and nobody can show a requirement was actually checked.",
			build: "Type a requirement, review the proposed test steps, run them, and get screenshots per step.",
			roleWork: {
				backend: "running browser sessions and storing evidence",
				ml: "turning requirements into reliable test steps",
			},
		},
	},
	{
		name: "Jo",
		cluster: "health",
		title: "Physio session guide",
		pitch: "Turns a physical therapist's exercise plan into a guided session on the phone, with form feedback from the camera.",
		skills: [
			["mobile", "expert"],
			["design", "intermediate"],
		],
		interests: ["health", "accessibility"],
		hours: 12,
		utc: -3,
		team: [2, 3],
		card: {
			problem:
				"Patients forget their exercises or do them wrong between appointments.",
			build: "Load a plan, follow each exercise with timers, and get simple form cues.",
			roleWork: {
				ml: "pose checks for a few exercises",
				backend: "plans from the therapist and progress for them",
			},
		},
	},
	{
		name: "Kemi",
		cluster: "agriculture and civic",
		title: "Offline crop doctor",
		pitch: "A voice copilot that diagnoses crop problems from a photo, offline, for farmers with poor connectivity.",
		skills: [
			["ml", "intermediate"],
			["mobile", "intermediate"],
		],
		interests: ["agriculture", "climate"],
		hours: 15,
		utc: 1,
		team: [2, 4],
		card: {
			problem:
				"Farmers lose crops to diseases an expert would spot, and have no signal to ask one.",
			build: "An app that runs a small model on the phone, answers by voice, and suggests a treatment.",
			roleWork: {
				backend: "syncing diagnoses when a connection comes back",
				design: "a voice-first flow for low-literacy users",
			},
		},
	},
	{
		name: "Leo",
		cluster: "education",
		title: "Audio maths for blind learners",
		pitch: "An audio-first maths companion that lets blind students work through problems by voice.",
		skills: [
			["design", "expert"],
			["frontend", "intermediate"],
		],
		interests: ["education", "accessibility"],
		hours: 10,
		utc: 0,
		team: [2, 3],
		card: {
			problem:
				"Maths tools are visual, so blind students depend on someone reading to them.",
			build: "Speak a problem, hear it read back structurally, and step through a solution by voice.",
			roleWork: {
				backend: "the session state and a problem bank",
				ml: "speech in and out, and reading equations aloud clearly",
			},
		},
	},
	{
		name: "Mira",
		cluster: "small business",
		title: "Invoice photo back office",
		pitch: "Turns photos of invoices and voice notes into bookkeeping entries for small shops.",
		skills: [
			["ml", "intermediate"],
			["backend", "intermediate"],
		],
		interests: ["small business", "finance"],
		hours: 20,
		utc: 0,
		team: [2, 3],
		card: {
			problem:
				"Shop owners keep paper invoices and never get to the books.",
			build: "Snap an invoice or record a note, see the entry it made, and export the month.",
			roleWork: {
				frontend: "the entries view and monthly export",
				design: "a flow that works for owners who aren't technical",
			},
		},
	},
	{
		name: "Nico",
		cluster: "media and games",
		title: "Soccer tactics from video",
		pitch: "Extracts formations and player movement from phone video of amateur soccer games, for coaches.",
		skills: [
			["ml", "intermediate"],
			["data", "intermediate"],
		],
		interests: ["gaming", "media"],
		hours: 15,
		utc: 2,
		team: [2, 3],
		card: {
			problem:
				"Amateur coaches can't afford tracking systems, but everyone films games on a phone.",
			build: "Upload a clip, get a top-down replay with formations marked.",
			roleWork: {
				frontend: "the top-down replay viewer",
				mobile: "recording guidance so clips are usable",
			},
		},
	},
	{
		name: "Omar",
		cluster: "agent safety",
		title: "MCP tool-change detector",
		pitch: "A CLI that fingerprints the tools an MCP server offers and flags descriptions that change to hide instructions.",
		skills: [
			["backend", "intermediate"],
			["devops", "intermediate"],
		],
		interests: ["security", "open source", "developer tools"],
		hours: 10,
		utc: -5,
		team: [2, 3],
		card: {
			problem:
				"An MCP server can quietly change a tool's description to inject instructions after you've approved it.",
			build: "A CLI that records tool fingerprints, alerts on changes, and shows the diff.",
			roleWork: {
				frontend: "a report page for diffs and alerts",
				ml: "scoring whether a changed description tries to steer the agent",
			},
		},
	},
	{
		name: "Priya",
		cluster: "developer tools",
		title: "Repo explainer",
		pitch: "Turns any code repository into a navigable explainer: what it does, how it's organized, and where to start.",
		skills: [
			["frontend", "intermediate"],
			["design", "intermediate"],
		],
		interests: ["developer tools", "education", "open source"],
		hours: 12,
		utc: 5.5,
		team: [2, 4],
		card: {
			problem:
				"New contributors spend days figuring out an unfamiliar codebase.",
			build: "Paste a repo URL, get a map of its parts and a guided tour of the main flows.",
			roleWork: {
				backend: "cloning and indexing repositories",
				ml: "summaries of modules and flows that stay accurate",
			},
		},
	},
	{
		name: "Quinn",
		cluster: "health",
		title: "Multilingual symptom intake",
		pitch: "Patients describe symptoms in their own language by voice, and clinicians get a structured summary in theirs.",
		skills: [
			["product", "expert"],
			["frontend", "intermediate"],
		],
		interests: ["health", "accessibility"],
		hours: 15,
		utc: -5,
		team: [3, 4],
		card: {
			problem:
				"Clinics lose time and accuracy when patient and clinician don't share a language.",
			build: "A voice intake in three languages and a one-page summary for the clinician.",
			roleWork: {
				ml: "speech recognition and translation into a structured summary",
				backend: "secure storage and the clinician's queue",
			},
		},
	},
	{
		name: "Rosa",
		cluster: "agriculture and civic",
		title: "Road damage to repairs",
		pitch: "Citizens report road damage with a photo; it becomes a work order, and the repair is checked from a later photo.",
		skills: [
			["frontend", "intermediate"],
			["product", "intermediate"],
		],
		interests: ["civic tech", "open source"],
		hours: 10,
		utc: -3,
		team: [2, 4],
		card: {
			problem:
				"Road reports disappear into city inboxes, and nobody checks whether repairs happened.",
			build: "Report with a photo, see it on a map, and see it closed with a before-and-after.",
			roleWork: {
				backend: "reports, work orders, and the map data",
				ml: "comparing before and after photos to verify a repair",
			},
		},
	},
	{
		name: "Sami",
		cluster: "education",
		title: "PDF to study set",
		pitch: "Turns lecture PDFs into summaries, flashcards, and quizzes students can practice from.",
		skills: [
			["backend", "intermediate"],
			["frontend", "intermediate"],
		],
		interests: ["education"],
		hours: 20,
		utc: 3,
		team: [2, 3],
		card: {
			problem:
				"Students have hundreds of pages of slides and no time to make study material.",
			build: "Upload a PDF, get a summary, a flashcard deck, and a quiz that adapts to wrong answers.",
			roleWork: {
				design: "a study flow students want to come back to",
				ml: "flashcards and questions that test understanding, not recall",
			},
		},
	},
	{
		name: "Tomas",
		cluster: "small business",
		title: "Household budget stress test",
		pitch: "A household budget in buckets, with a simulator that shows what a job loss or big bill would do to it.",
		skills: [
			["data", "intermediate"],
			["frontend", "intermediate"],
		],
		interests: ["finance"],
		hours: 8,
		utc: -8,
		team: [2, 3],
		card: {
			problem:
				"Families budget month to month and don't know how long they'd last after a shock.",
			build: "Enter income and costs, sort them into buckets, and run a few shock scenarios.",
			roleWork: {
				backend: "accounts, saved budgets, and scenario runs",
				design: "making the scenarios easy to understand",
			},
		},
	},
	{
		name: "Uma",
		cluster: "agent safety",
		title: "Agent runtime with chaos lab",
		pitch: "A multi-agent runtime that records every agent action for replay, with a chaos lab that injects failures on purpose.",
		skills: [["backend", "expert"]],
		interests: ["AI agents", "open source", "developer tools"],
		hours: 18,
		utc: 2,
		team: [2, 4],
		card: {
			problem:
				"When a multi-agent system fails, nobody can replay what happened or test how it handles failure.",
			build: "Run a few agents, record every step, replay a run, and inject a tool failure.",
			roleWork: {
				frontend: "a timeline viewer for recorded runs",
				devops: "packaging the runtime and the chaos scenarios",
			},
		},
	},
	{
		name: "Victor",
		cluster: "developer tools",
		title: "Self-healing QA crawler",
		pitch: "Crawls a web app continuously to find runtime errors and broken flows, and proposes fixes.",
		skills: [
			["backend", "intermediate"],
			["devops", "intermediate"],
		],
		interests: ["developer tools"],
		hours: 15,
		utc: 1,
		team: [2, 3],
		card: {
			problem:
				"Broken flows reach users because tests only cover what someone thought to write.",
			build: "Point it at a staging app, get a report of broken flows with a suggested fix for each.",
			roleWork: {
				frontend: "the report and its replays",
				ml: "exploring the app sensibly and proposing fixes",
			},
		},
	},
	{
		name: "Wen",
		cluster: "health",
		title: "Toxic plant checker for pets",
		pitch: "Snap a plant to learn whether it's toxic to your cat or dog, and what to do if they ate it.",
		skills: [
			["mobile", "intermediate"],
			["ml", "beginner"],
		],
		interests: ["health"],
		hours: 6,
		utc: 8,
		team: [2, 3],
		card: {
			problem:
				"Pet owners don't know which houseplants are dangerous until it's an emergency.",
			build: "A camera app that identifies common plants and shows a toxicity card per pet.",
			roleWork: {
				backend: "the plant database and lookups",
				design: "a calm, clear emergency screen",
			},
		},
	},
	{
		name: "Xavi",
		cluster: "agriculture and civic",
		title: "Poultry early warning",
		pitch: "Early warnings for small poultry farms from sensor readings and photos, before disease spreads.",
		skills: [
			["backend", "intermediate"],
			["data", "intermediate"],
		],
		interests: ["agriculture"],
		hours: 12,
		utc: 0,
		team: [2, 3],
		card: {
			problem:
				"Small farms spot disease too late and lose a whole flock.",
			build: "Sensor and photo uploads, a risk score per barn, and alerts by text.",
			roleWork: {
				mobile: "the farmer's app for photos and alerts",
				ml: "spotting sick birds in photos",
			},
		},
	},
	{
		name: "Yara",
		cluster: "education",
		title: "Books in home languages",
		pitch: "Makes illustrated children's books in under-served languages, from a story idea.",
		skills: [
			["product", "intermediate"],
			["design", "intermediate"],
		],
		interests: ["education", "media"],
		hours: 8,
		utc: 2,
		team: [2, 4],
		card: {
			problem:
				"Children in many languages have almost no books in the language they speak at home.",
			build: "Write a story idea, pick a language, and get an illustrated book to read and print.",
			roleWork: {
				ml: "translation and illustrations that stay consistent",
				frontend: "the reader and the print layout",
			},
		},
	},
	{
		name: "Zane",
		cluster: "agent safety",
		title: "Agent belief receipts",
		pitch: "Keeps a receipt for every belief an agent acts on: what it believed, when it learned it, and why.",
		skills: [
			["data", "expert"],
			["backend", "intermediate"],
		],
		interests: ["AI agents", "research"],
		hours: 12,
		utc: -8,
		team: [2, 3],
		card: {
			problem:
				"When an agent acts on a wrong belief, there's no record of where the belief came from.",
			build: "A library agents write beliefs to, and a view that traces an action back to its sources.",
			roleWork: {
				frontend: "the trace view from action to sources",
				ml: "extracting beliefs from an agent's messages",
			},
		},
	},
	{
		name: "Amir",
		cluster: "agent safety",
		title: "Risky-setup reviewer",
		pitch: "Reviews an agent's setup for the dangerous mix of private data, untrusted input, and outbound access.",
		skills: [
			["product", "expert"],
			["ml", "intermediate"],
		],
		interests: ["security", "AI agents"],
		hours: 10,
		utc: 1,
		team: [2, 4],
		card: {
			problem:
				"Builders wire agents to email, files, and the web without seeing how that adds up to a leak.",
			build: "Describe or import an agent's tools, get a risk report with the paths that could leak data.",
			roleWork: {
				backend: "importing agent configs and analyzing tool paths",
				frontend: "the risk report",
			},
		},
	},
	{
		name: "Bea",
		cluster: "agriculture and civic",
		title: "Accessibility barrier finder",
		pitch: "Finds accessibility barriers in public spaces from photos, like steps without ramps, and maps them.",
		skills: [
			["ml", "intermediate"],
			["design", "intermediate"],
		],
		interests: ["accessibility", "civic tech"],
		hours: 10,
		utc: -5,
		team: [2, 3],
		card: {
			problem:
				"Wheelchair users find barriers only when they arrive, and cities don't know where they are.",
			build: "Upload street photos, get barriers detected and pinned on a shared map.",
			roleWork: {
				mobile: "an app for taking and tagging photos",
				backend: "the shared map and its data",
			},
		},
	},
	{
		name: "Caio",
		cluster: "developer tools",
		title: "Context-window tracer",
		pitch: "A VS Code extension that shows what's in a model's context window and maps each part back to the code that put it there.",
		skills: [
			["frontend", "intermediate"],
			["ml", "intermediate"],
		],
		interests: ["developer tools", "AI agents"],
		hours: 12,
		utc: -3,
		team: [2, 3],
		card: {
			problem:
				"Developers can't see why their LLM app sent what it sent.",
			build: "Run your app, open a panel showing each request's context, click a part to jump to its source.",
			roleWork: {
				backend: "capturing requests from a running app",
				design: "a panel that stays readable for long contexts",
			},
		},
	},
	{
		name: "Dev",
		cluster: "small business",
		title: "No-show shield",
		pitch: "Cuts no-shows for appointment businesses with smart reminders and easy rebooking.",
		skills: [
			["frontend", "intermediate"],
			["product", "intermediate"],
		],
		interests: ["small business"],
		hours: 15,
		utc: 5.5,
		team: [2, 3],
		card: {
			problem:
				"Small appointment businesses lose a day of income a week to no-shows.",
			build: "Import bookings, send reminders that let people confirm or rebook in one tap.",
			roleWork: {
				backend: "bookings, reminders, and rebooking logic",
				data: "learning which customers need an extra reminder",
			},
		},
	},
];

// The cast's ids: "c1" to "c30", which can't clash with generated people ("p1", …) or real ones ("p-…").
export const CAST: CastMember[] = SEEDS.map((seed, i) => {
	const own = new Set(seed.skills.map(([role]) => role));
	return {
		cluster: seed.cluster,
		needs: (Object.keys(seed.card.roleWork) as Role[]).filter(
			(role) => !own.has(role),
		),
		card: seed.card,
		// Parse so a mistake in the cast fails loudly.
		profile: Profile.parse({
			id: `c${i + 1}`,
			name: seed.name,
			skills: seed.skills.map(([name, level]) => ({ name, level })),
			interests: seed.interests,
			projectIdeas: [
				{
					title: seed.title,
					description: `${seed.pitch} ${seed.card.problem} A weekend build: ${seed.card.build}`,
				},
			],
			availability: { hoursPerWeek: seed.hours, utcOffset: seed.utc },
			preferences: {
				minTeamSize: seed.team[0],
				maxTeamSize: seed.team[1],
				preferredRoles: [seed.skills[0]![0]],
			},
		}),
	};
});

// The first `count` of the cast, which mixes every cluster, since the cast is ordered round-robin.
export function castProfiles(count: number): Profile[] {
	return CAST.slice(0, count).map((member) => member.profile);
}

// The id of the cast member whose project has this title; throws on a typo, so the answer key can't drift.
function byTitle(title: string): string {
	const member = CAST.find((m) => m.profile.projectIdeas[0]?.title === title);
	if (!member) throw new Error(`no cast member with the project "${title}"`);
	return member.profile.id;
}

// Groups a sensible person would expect to work well, written before any run, to judge runs against. Each
// group shares a direction, and most cover their members' needs between them; the two agent groups lack
// frontend, which is where someone like the Muse sessions' human fits. Members outside these groups may still
// fit; a team across clusters isn't wrong, just not predicted. The budget simulator and the two media projects
// are in no group: nothing in the cast fits them well.
export const EXPECTED_GROUPS: { members: string[]; why: string }[] = [
	{
		titles: [
			"Agent action firewall",
			"MCP tool-change detector",
			"Risky-setup reviewer",
		],
		why: "an agent security suite: a firewall, a tool-change detector, and a setup reviewer",
	},
	{
		titles: [
			"Agent runtime with chaos lab",
			"Agent belief receipts",
			"Done-checker for agents",
		],
		why: "agent observability: recording runs, tracing beliefs, and checking claims, all about seeing what agents did",
	},
	{
		titles: [
			"UI bug finder",
			"Requirement to tested",
			"Self-healing QA crawler",
		],
		why: "testing apps: UI bugs, requirement tests, and broken flows, with frontend, ml, and backend between them",
	},
	{
		titles: ["Repo explainer", "Context-window tracer"],
		why: "understanding code: both help developers read unfamiliar systems",
	},
	{
		titles: ["Blood smear assistant", "Multilingual symptom intake"],
		why: "clinical tools, where ml and product cover each other",
	},
	{
		titles: ["Physio session guide", "Toxic plant checker for pets"],
		why: "care on the phone, both camera-first mobile apps",
	},
	{
		titles: ["Offline crop doctor", "Poultry early warning"],
		why: "small farms, offline and mobile-first",
	},
	{
		titles: [
			"Flood alerts from satellites",
			"Road damage to repairs",
			"Accessibility barrier finder",
		],
		why: "civic mapping: floods, road damage, and barriers on shared maps",
	},
	{
		titles: [
			"Physics step checker",
			"Audio maths for blind learners",
			"PDF to study set",
			"Books in home languages",
		],
		why: "learning tools for students and children",
	},
	{
		titles: [
			"WhatsApp salon assistant",
			"Invoice photo back office",
			"No-show shield",
		],
		why: "operations for the same kind of small-business owner",
	},
].map(({ titles, why }) => ({ members: titles.map(byTitle), why }));

// Where an outside agent's human with agent-reliability ideas (the Muse sessions) would be expected to fit:
// the safety and observability groups, which need frontend and share their direction.
export const EXPECTED_FOR_AGENT_RELIABILITY = [
	"Agent action firewall",
	"MCP tool-change detector",
	"Agent runtime with chaos lab",
	"Agent belief receipts",
	"Done-checker for agents",
].map(byTitle);

// How a final team compares with the answer key, counting only its cast members: all in one expected group,
// all in one cluster but not a predicted group, or across clusters.
export type CastVerdict = "predicted" | "same cluster" | "across clusters";

export function judgeTeam(members: readonly string[]): {
	verdict: CastVerdict;
	clusters: Cluster[];
} {
	const cast = members.flatMap((id) => {
		const member = CAST.find((m) => m.profile.id === id);
		return member ? [member] : [];
	});
	const ids = cast.map((m) => m.profile.id);
	const clusters = [...new Set(cast.map((m) => m.cluster))];
	if (
		EXPECTED_GROUPS.some((g) => ids.every((id) => g.members.includes(id)))
	) {
		return { verdict: "predicted", clusters };
	}
	return {
		verdict: clusters.length <= 1 ? "same cluster" : "across clusters",
		clusters,
	};
}
