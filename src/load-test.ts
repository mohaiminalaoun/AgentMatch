// Entry point for `npm run load-test [count]`: fires many calls at once through the queued, retrying client.
import { createLlmClient } from "./engine/client.js";
import { loadConfig, readEnvFile } from "./engine/config.js";
import { exchangeEvent } from "./engine/events.js";
import { createRunLog } from "./engine/runlog.js";

const count = Number(process.argv[2] ?? 50);
if (!Number.isInteger(count) || count < 1) {
	console.error("Usage: npm run load-test [count]");
	process.exit(1);
}

readEnvFile();
const config = loadConfig(process.env);
const log = createRunLog("load-test");
let completed = 0;
const client = createLlmClient(config, {
	retry: {
		onRetry: ({ retry, delayMs, error }) =>
			console.log(
				`  retry ${retry} after ${error.status ?? "network error"} · waiting ${(delayMs / 1000).toFixed(1)}s`,
			),
	},
});

console.log(
	`${count} calls · concurrency ${config.maxConcurrency} · ${config.model}\n`,
);
const started = performance.now();
let tokens = 0;
const results = await Promise.allSettled(
	Array.from({ length: count }, (_, i) =>
		client
			.chat([{ role: "user", content: `Reply with just: OK ${i + 1}` }], {
				onExchange: (exchange) => {
					log.write(exchangeEvent(exchange));
					tokens += exchange.usage?.total ?? 0;
				},
			})
			.then(() => {
				completed++;
				process.stdout.write(`\r  done ${completed}/${count}`);
			}),
	),
);
const wallSeconds = (performance.now() - started) / 1000;
const failures = results.flatMap((r) =>
	r.status === "rejected" ? [(r.reason as Error).message.split("\n")[0]] : [],
);
const requestSeconds = client.stats.requestMs / 1000;

console.log(`

Completed:        ${count - failures.length}/${count}
Failed:           ${failures.length}
429s received:    ${client.stats.rateLimited}
Other retries:    ${client.stats.retries - client.stats.rateLimited}
Peak in flight:   ${client.stats.peakInFlight}
Wall time:        ${wallSeconds.toFixed(1)}s   (vs ~${requestSeconds.toFixed(0)}s one after another → ${(requestSeconds / wallSeconds).toFixed(1)}× faster)
Tokens:           ${tokens}
Log:              ${log.path}`);
for (const failure of new Set(failures)) {
	console.log(`  ✗ ${failure}`);
}
process.exit(failures.length > 0 ? 1 : 0);
