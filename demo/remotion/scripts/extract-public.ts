import { writeFileSync } from "node:fs";
import { readRunLog } from "../../../src/engine/runlog.js";
import { teamStory } from "../../../src/ui/web/replay.js";
const events = readRunLog("runs/2026-11-03T17-57-10-749Z-pilot.jsonl");
const event = events
	.filter((e) => e.type === "team" && e.team.id === "team-c6")
	.at(-1);
if (!event || event.type !== "team") throw Error("Missing recorded team");
const story = teamStory(events, event.team);
// Explicit allowlist: no profiles, private rationales, prompts, or instructions.
const versions = story.idea.versions.map(
	({ how, author, from, to, title, pitch, rolesNeeded, card, status }) => ({
		how,
		author,
		from,
		to,
		title,
		pitch,
		rolesNeeded,
		card,
		status,
	}),
);
writeFileSync(
	"demo/remotion/src/public-project.ts",
	"import type {IdeaVersion, Event} from '../../../src/ui/web/replay';\nconst data: {versions:IdeaVersion[];agreed:number|undefined;team:Extract<Event,{type:'team'}>['team'];owner:string;founder:string|undefined} = " +
		JSON.stringify(
			{
				versions,
				agreed: story.idea.agreed,
				team: event.team,
				owner: story.owner,
				founder: story.founder,
			},
			null,
			2,
		) +
		";\nexport default data;\n",
);
