// Entry point for `npm run ask "prompt"`: sends one prompt to the configured model and prints the full exchange.
import { loadConfig, readEnvFile } from "./engine/config.js";
import { chat, formatExchange } from "./engine/llm.js";
import { exchangeEvent } from "./engine/events.js";
import { createRunLog } from "./engine/runlog.js";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
	console.error('Usage: npm run ask "your prompt"');
	process.exit(1);
}

try {
	readEnvFile();
	const config = loadConfig(process.env);
	const log = createRunLog("ask");
	const started = performance.now();
	const reply = await chat(config, [{ role: "user", content: prompt }], {
		onExchange: (exchange) => {
			log.write(exchangeEvent(exchange));
			console.log(formatExchange(exchange));
		},
	});
	const seconds = ((performance.now() - started) / 1000).toFixed(1);

	const usage = reply.usage
		? `${reply.usage.total} tokens (${reply.usage.input} in, ${reply.usage.output} out)`
		: "token usage not reported";
	console.log(
		`\n${usage} · ${seconds}s · ${config.model} · log: ${log.path}`,
	);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
