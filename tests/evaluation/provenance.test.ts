import { describe, expect, test } from "vitest";
import type { RunEvent } from "../../src/engine/events.js";
import {
	decisionProvenance,
	describeProvenance,
} from "../../src/evaluation/provenance.js";

const decision = (
	agent: string,
	extra: { fellBack?: boolean; gateBlocks?: number } = {},
): RunEvent => ({
	type: "decision",
	agent,
	proposalId: "prop",
	decision: { decision: "decline" },
	gateBlocks: extra.gateBlocks ?? 0,
	fellBack: extra.fellBack ?? false,
});

const brains: RunEvent = {
	type: "brains",
	agents: { muse: "mailbox:muse", other: "some-model" },
};

const mailbox = (reason?: "timeout" | "schema_failure"): RunEvent => ({
	type: "mailbox",
	time: "2026-11-10T00:00:00.000Z",
	agent: "muse",
	requestId: "r1",
	kind: "decision",
	level: 0,
	attempt: 1,
	elapsedMs: 10,
	status: "fallback",
	...(reason ? { reason } : {}),
});

describe("decisionProvenance", () => {
	test("splits decisions into model, outside agent, and default", () => {
		const r = decisionProvenance([
			brains,
			decision("a"),
			decision("muse"),
			decision("muse", { fellBack: true }),
			decision("a", { fellBack: true }),
		]);
		expect(r.decisions).toBe(4);
		expect(r.bySource).toEqual({ model: 1, outside: 1, default: 2 });
	});

	test("a default is a default even for an outside agent, and a brain naming a model is not outside", () => {
		const r = decisionProvenance([
			brains,
			decision("other"),
			decision("muse", { fellBack: true }),
		]);
		expect(r.bySource).toEqual({ model: 1, outside: 0, default: 1 });
	});

	test("without a brains event every answer is the model's", () => {
		const r = decisionProvenance([decision("muse"), decision("a")]);
		expect(r.bySource).toEqual({ model: 2, outside: 0, default: 0 });
	});

	test("counts gate stops, trimmed offers, and neutralized hunches as overrides", () => {
		const r = decisionProvenance([
			decision("a", { gateBlocks: 2 }),
			decision("a", { gateBlocks: 0 }),
			{
				type: "offers",
				agent: "a",
				to: ["x"],
				places: 2,
				fellBack: false,
				dropped: [{ id: "y", reason: "no fit" }],
			},
			{
				type: "offers",
				agent: "a",
				to: ["x"],
				places: 2,
				fellBack: false,
			},
			{
				type: "hunch",
				agent: "a",
				other: "b",
				steer: "neutral",
				riskArea: null,
				fellBack: false,
				unfounded: true,
			},
		]);
		expect(r.overrides).toEqual({
			gateBlocked: 1,
			offersDropped: 1,
			hunchesNeutralized: 1,
		});
		expect(r.decisions).toBe(5);
	});

	test("counts outside-agent defaults by reason, apart from decisions", () => {
		const r = decisionProvenance([
			mailbox("timeout"),
			mailbox("timeout"),
			mailbox("schema_failure"),
			mailbox(),
		]);
		expect(r.decisions).toBe(0);
		expect(r.outsideFallbacks).toEqual({
			timeout: 2,
			schema_failure: 1,
			unknown: 1,
		});
	});

	test("events without a fellBack, and a log with no decisions, count nothing", () => {
		expect(decisionProvenance([{ type: "tick", n: 1 }]).decisions).toBe(0);
		expect(describeProvenance(decisionProvenance([]))).toBe(
			"no decisions logged",
		);
	});
});

describe("describeProvenance", () => {
	test("reads as one line with shares and the outside defaults", () => {
		const line = describeProvenance(
			decisionProvenance([
				brains,
				decision("a"),
				decision("muse"),
				decision("muse", { fellBack: true }),
				decision("a", { gateBlocks: 1 }),
				mailbox("timeout"),
			]),
		);
		expect(line).toContain("4 decisions");
		expect(line).toContain("model 2 (50%)");
		expect(line).toContain("outside 1 (25%)");
		expect(line).toContain("default 1 (25%)");
		expect(line).toContain("gate stopped 1");
		expect(line).toContain("outside defaults: timeout 1");
	});
});
