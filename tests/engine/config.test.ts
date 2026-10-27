import { describe, expect, test } from "vitest";
import { loadConfig } from "../../src/engine/config.js";

const env = {
	LLM_BASE_URL: "https://llm.example.com/v1",
	LLM_API_KEY: "test-key-123",
	LLM_MODEL: "test-model",
};

// The error message loadConfig throws for `input`, or "" if it doesn't throw.
function errorFor(input: Record<string, string | undefined>): string {
	try {
		loadConfig(input);
		return "";
	} catch (error) {
		return (error as Error).message;
	}
}

describe("loadConfig", () => {
	test("valid settings become a camelCase config", () => {
		expect(loadConfig(env)).toEqual({
			baseUrl: "https://llm.example.com/v1",
			apiKey: "test-key-123",
			model: "test-model",
			maxConcurrency: 8,
		});
	});

	test("LLM_MAX_CONCURRENCY is read as a number", () => {
		expect(
			loadConfig({ ...env, LLM_MAX_CONCURRENCY: "20" }).maxConcurrency,
		).toBe(20);
	});

	test("an invalid LLM_MAX_CONCURRENCY fails", () => {
		for (const value of ["0", "2.5", "lots"]) {
			expect(errorFor({ ...env, LLM_MAX_CONCURRENCY: value })).toContain(
				"LLM_MAX_CONCURRENCY must be a whole number",
			);
		}
	});

	test("unrelated variables are ignored", () => {
		expect(loadConfig({ ...env, PATH: "/usr/bin" })).not.toHaveProperty(
			"PATH",
		);
	});

	test("a missing key is named in the error", () => {
		const { LLM_API_KEY: _, ...rest } = env;
		expect(errorFor(rest)).toContain("LLM_API_KEY is missing");
	});

	test("every problem is reported at once", () => {
		const message = errorFor({ LLM_BASE_URL: env.LLM_BASE_URL });
		expect(message).toContain("LLM_API_KEY");
		expect(message).toContain("LLM_MODEL");
	});

	test("an empty value counts as missing", () => {
		expect(errorFor({ ...env, LLM_MODEL: "" })).toContain(
			"LLM_MODEL is missing",
		);
	});

	test("a malformed URL fails", () => {
		expect(errorFor({ ...env, LLM_BASE_URL: "not a url" })).toContain(
			"LLM_BASE_URL must be a URL",
		);
	});

	test("an unfilled placeholder fails", () => {
		expect(errorFor({ ...env, LLM_API_KEY: "replace-me" })).toContain(
			"placeholder",
		);
	});

	test("the error explains how to fix it", () => {
		expect(errorFor({})).toContain("Copy .env.example to .env");
	});

	test("the error never contains the API key", () => {
		const message = errorFor({ ...env, LLM_BASE_URL: "not a url" });
		expect(message).not.toBe("");
		expect(message).not.toContain(env.LLM_API_KEY);
	});
});
