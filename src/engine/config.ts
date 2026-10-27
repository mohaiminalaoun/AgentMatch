import { z } from "zod";

// The value `.env.example` uses for settings you have to fill in yourself.
const PLACEHOLDER = "replace-me";

const filledIn = z
	.string()
	.min(1, { error: "is missing" })
	.refine((value) => value !== PLACEHOLDER, {
		error: `still has the "${PLACEHOLDER}" placeholder`,
	});

const Env = z.object({
	LLM_BASE_URL: z.url({ error: "must be a URL like https://host/v1" }),
	LLM_API_KEY: filledIn,
	LLM_MODEL: filledIn,
	LLM_MAX_CONCURRENCY: z.coerce
		.number({ error: "must be a whole number of at least 1" })
		.int({ error: "must be a whole number of at least 1" })
		.min(1, { error: "must be a whole number of at least 1" })
		.optional(),
});

// Requests in flight at once when LLM_MAX_CONCURRENCY isn't set.
const DEFAULT_MAX_CONCURRENCY = 8;

export type Config = {
	baseUrl: string;
	apiKey: string;
	model: string;
	maxConcurrency: number;
};

// Checks the LLM settings and renames them; takes `env` as a parameter so tests never need real secrets.
// Error messages name the bad settings but never print their values, since one is the API key.
export function loadConfig(env: Record<string, string | undefined>): Config {
	const result = Env.safeParse(env);
	if (!result.success) {
		const problems = result.error.issues.map((issue) => {
			const name = String(issue.path[0]);
			return env[name] === undefined
				? `- ${name} is missing`
				: `- ${name} ${issue.message}`;
		});
		throw new Error(
			[
				"LLM settings are invalid:",
				...problems,
				"Copy .env.example to .env and fill in your values.",
			].join("\n"),
		);
	}
	return {
		baseUrl: result.data.LLM_BASE_URL,
		apiKey: result.data.LLM_API_KEY,
		model: result.data.LLM_MODEL,
		maxConcurrency:
			result.data.LLM_MAX_CONCURRENCY ?? DEFAULT_MAX_CONCURRENCY,
	};
}

// Reads `.env` into process.env if the file exists; entry points call this once at startup.
export function readEnvFile(path = ".env"): void {
	try {
		process.loadEnvFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
}
