import { describe, expect, test } from "vitest";
import type { Config } from "../../src/engine/config.js";
import { assertRealDataModel } from "../../src/pilot/model.js";

const config = (model: string): Config => ({
	baseUrl: "https://llm.example.com/v1",
	apiKey: "test-key-123",
	model,
	maxConcurrency: 4,
});

describe("assertRealDataModel", () => {
	test("refuses a model the provider trains on", () => {
		expect(() =>
			assertRealDataModel(config("muse-spark-1.3-contributor")),
		).toThrow("must never see real people's data");
	});

	test("allows the regular model", () => {
		expect(() =>
			assertRealDataModel(config("muse-spark-1.3")),
		).not.toThrow();
	});

	test("never prints the API key", () => {
		expect(() =>
			assertRealDataModel(config("muse-spark-1.3-contributor")),
		).toThrow(
			expect.objectContaining({
				message: expect.not.stringContaining("test-key-123"),
			}),
		);
	});
});
