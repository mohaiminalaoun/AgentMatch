import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { IdeaTimeline } from "../../src/ui/web/IdeaTimeline.js";
import { ideaVersions, type Event } from "../../src/ui/web/replay.js";
import { ideaTimeline, stepVerb } from "../../src/ui/web/timeline.js";

test("public repair timeline shows actual removed work and group consent without private reasoning", () => {
	const team = {
		id: "team-a",
		members: ["a", "b"],
		project: { title: "Practice", description: "Local practice" },
		rolesNeeded: ["ml"],
		status: "committed" as const,
	};
	const events: Event[] = [
		{ type: "team", team },
		{
			type: "repair",
			team: team.id,
			agent: "a",
			step: "proposal",
			revision: {
				title: "Practice Lite",
				pitch: "Practice bundled examples",
				build: "Five bundled examples",
				rolesNeeded: ["ml"],
			},
			removedWork: [
				{
					role: "backend",
					change: "Replace server accounts with local state.",
				},
			],
			rationale: "PRIVATE-OWNER-MARKER",
			fellBack: false,
		},
		{
			type: "repair",
			team: team.id,
			agent: "a",
			step: "result",
			applied: true,
			fellBack: false,
		},
	];
	const idea = ideaVersions(events, "a", "b");
	const html = renderToStaticMarkup(
		React.createElement(IdeaTimeline, {
			timeline: ideaTimeline(idea, team),
			owner: "a",
			founder: "b",
			status: "committed",
			anchorPrefix: team.id,
			filledBy: undefined,
			showPrivate: false,
		}),
	);
	expect(html).toContain("pre-deadline scope repair");
	expect(html).toContain("Replace server accounts with local state.");
	expect(html).toContain("All 2 team members approved");
	expect(html).toContain("Confirmed by agents");
	expect(html).not.toContain("PRIVATE-OWNER-MARKER");
	expect(stepVerb(idea.versions[0]!)).toBe("repaired scope");
	const { scopeRepair: _, ...negotiation } = idea.versions[0]!;
	expect(stepVerb(negotiation)).toBe("reshaped");
});
