import { describe, expect, test } from "vitest";
import { createAgent, raiseLevel } from "../../src/engine/agent.js";
import { createLlmClient } from "../../src/engine/client.js";
import type { Config } from "../../src/engine/config.js";
import { checkInterest, interestMessages } from "../../src/engine/interest.js";
import { sampleProfile } from "../fixtures.js";

const config: Config = {
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model: "test-model",
	maxConcurrency: 4,
};

// Ada's agent at `level` with p9.
const at = (level: 1 | 2) =>
	raiseLevel(createAgent(sampleProfile), "p9", level);

// A client whose fake model always gives `reply`.
function fakeModel(reply: object) {
	const fetch = (async () =>
		new Response(
			JSON.stringify({
				choices: [{ message: { content: JSON.stringify(reply) } }],
			}),
		)) as typeof globalThis.fetch;
	return createLlmClient(config, { fetch, retry: { sleep: async () => {} } });
}

describe("interestMessages", () => {
	test("at level 1, interests alone aren't a reason to withdraw, since skills come next", () => {
		const [system] = interestMessages(at(1), "p9");
		expect(system!.content).toContain(
			"don't withdraw over interests alone",
		);
		expect(system!.content).toContain("time zones");
	});

	test("at level 2, the check is about complementary skills", () => {
		const [system] = interestMessages(at(2), "p9");
		expect(system!.content).toContain("complement");
	});
});

describe("checkInterest", () => {
	test("returns the model's answer and private rationale", async () => {
		const result = await checkInterest(
			fakeModel({ rationale: "Hours overlap.", interest: "continue" }),
			at(1),
			"p9",
		);
		expect(result).toMatchObject({
			interest: "continue",
			rationale: "Hours overlap.",
			fellBack: false,
		});
	});

	test("withdraws if no valid answer comes back, since continuing would share more", async () => {
		const result = await checkInterest(
			fakeModel({ interest: "maybe" }),
			at(1),
			"p9",
		);
		expect(result).toMatchObject({ interest: "withdraw", fellBack: true });
	});
});
