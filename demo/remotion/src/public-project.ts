import type { IdeaVersion, Event } from "../../../src/ui/web/replay";
const data: {
	versions: IdeaVersion[];
	agreed: number | undefined;
	team: Extract<Event, { type: "team" }>["team"];
	owner: string;
	founder: string | undefined;
} = {
	versions: [
		{
			how: "proposal",
			author: "c13",
			from: "c13",
			to: "c6",
			title: "Invoice Back Office",
			pitch: "Snap photos of invoices and voice notes to turn them into bookkeeping entries with a monthly export.",
			rolesNeeded: ["frontend", "design"],
			card: {
				problem:
					"Small shop owners keep paper invoices and never get their books done.",
				build: "A weekend build lets users snap an invoice or record a note, see the entry it created, and export the month.",
				roleWork: {
					frontend: "entries view and monthly export UI",
					design: "simple flow for non-technical owners",
				},
			},
			status: "accepted",
		},
		{
			how: "revision",
			author: "c6",
			from: "c6",
			to: "c13",
			title: "Chat Ledger",
			pitch: "Snap invoice photos and voice notes in chat to build bookkeeping entries with a monthly export file.",
			rolesNeeded: ["ml"],
			card: {
				problem:
					"Small shop owners keep paper invoices and never get their books done.",
				build: "Chat intake creates entries via extraction, confirm in chat, and download month export.",
				roleWork: {
					ml: "photo and voice note extraction to entries",
				},
			},
			status: "adopted",
		},
	],
	agreed: 1,
	team: {
		id: "team-c6",
		members: ["c6", "c13"],
		project: {
			title: "Chat Ledger",
			description:
				"Snap invoice photos and voice notes in chat to build bookkeeping entries with a monthly export file.",
		},
		rolesNeeded: ["ml"],
		problem:
			"Small shop owners keep paper invoices and never get their books done.",
		build: "Chat intake creates entries via extraction, confirm in chat, and download month export.",
		roleWork: {
			ml: "photo and voice note extraction to entries",
		},
		roles: {
			c13: "ml",
		},
		status: "committed",
	},
	owner: "c6",
	founder: "c13",
};
export default data;
