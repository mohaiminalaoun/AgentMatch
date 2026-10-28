import { describe, expect, test } from "vitest";
import { formatEvent } from "../src/describe.js";
import type { RunEvent } from "../src/engine/events.js";

const decision: RunEvent = {
	type: "decision",
	agent: "kemi",
	proposalId: "p1",
	decision: { decision: "accept" },
	rationale: "Strong fit for her frontend skills.",
	gateBlocks: 0,
	fellBack: false,
};

describe("formatEvent", () => {
	test("includes the private rationale by default, for show-run", () => {
		expect(formatEvent(decision)).toBe(
			"     kemi decides accept · private: Strong fit for her frontend skills.",
		);
	});

	test("leaves the rationale out when asked, for a shorter live view", () => {
		expect(formatEvent(decision, { rationale: false })).toBe(
			"     kemi decides accept",
		);
	});

	test("model calls have no line of their own", () => {
		expect(
			formatEvent({
				type: "exchange",
				time: "2026-10-28T00:00:00.000Z",
				messages: [],
				reply: "{}",
			}),
		).toBeUndefined();
	});
});
