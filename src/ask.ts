// Entry point for `npm run ask "prompt"`: sends one prompt to the configured model and prints the reply.
import { loadConfig, readEnvFile } from "./engine/config.js";
import { chat } from "./engine/llm.js";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
	console.error('Usage: npm run ask "your prompt"');
	process.exit(1);
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const started = performance.now();
	const reply = await chat(config, [{ role: "user", content: prompt }]);
	const seconds = ((performance.now() - started) / 1000).toFixed(1);

	console.log(reply.content);
	const usage = reply.usage
		? `${reply.usage.total} tokens (${reply.usage.input} in, ${reply.usage.output} out)`
		: "token usage not reported";
	console.log(`\n${usage} · ${seconds}s · ${config.model}`);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
