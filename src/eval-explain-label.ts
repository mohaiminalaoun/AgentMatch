// Entry point for checking the explanation judge against a person's own labels, in two steps:
//   npm run eval:explain:label -- <explain.json> [--claims N --seed S]
//     writes a labelling page next to it in runs/: N claims (default 30, half of them ones the judge flagged),
//     each with the agent's prompt and rationale but not the judge's verdict, to label in the browser and
//     download as JSON.
//   npm run eval:explain:label -- <explain.json> --labels <labels.json>
//     prints how well the judge agrees with those labels, and every disagreement.
// No model calls. The page and labels quote private rationales and prompts, so they stay out of git.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readRunLog } from "./engine/runlog.js";
import {
	agreement,
	explainedCalls,
	JudgmentFile,
	labelSample,
	Labels,
} from "./evaluation/explain.js";

function flag(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}

const source = process.argv
	.slice(2)
	.find(
		(arg, i, args) =>
			!arg.startsWith("--") && !args[i - 1]?.startsWith("--"),
	);
const labelsPath = flag("labels");
const count = Number(flag("claims") ?? "30");
const seed = Number(flag("seed") ?? "1");

if (
	!source ||
	!Number.isInteger(count) ||
	count < 1 ||
	!Number.isInteger(seed)
) {
	console.error(
		"Usage: npm run eval:explain:label -- <explain.json> [--claims N --seed S | --labels <labels.json>]",
	);
	process.exit(1);
}

// The labelling page: the claims without the judge's verdicts, saved in the browser as they're labelled.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Label Claims</title>
<style>
	:root { --bg: #fbfaf7; --surface: #fff; --text: #1f2328; --muted: #5d6470; --line: #e3e0d8; --accent: #2f6f5e; --accent-soft: #e6f1ed; --code: #f2efe8; --private: #f6f0ff; --private-line: #8a63d2; }
	@media (prefers-color-scheme: dark) { :root { --bg: #16181b; --surface: #1d2024; --text: #e6e6e3; --muted: #a3a8b0; --line: #30343a; --accent: #7cc4ad; --accent-soft: #1f312b; --code: #26292e; --private: #261f33; --private-line: #b394f0; } }
	* { box-sizing: border-box; }
	body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
	main { max-width: 860px; margin: 0 auto; padding: 28px 16px 120px; }
	h1 { font-size: 22px; margin: 0 0 6px; }
	.muted { color: var(--muted); }
	.guide { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin: 16px 0; font-size: 14px; }
	.guide dt { font-weight: 600; margin-top: 6px; }
	.guide dd { margin: 0 0 0 16px; }
	.item { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin: 16px 0; }
	.item.done { border-color: var(--accent); }
	.kind { font-size: 12px; font-weight: 600; color: var(--muted); }
	.claim { font-size: 17px; font-weight: 600; margin: 4px 0 10px; overflow-wrap: anywhere; }
	.rationale { padding: 8px 12px; background: var(--private); border-left: 3px solid var(--private-line); border-radius: 0 6px 6px 0; font-size: 14px; overflow-wrap: anywhere; }
	details { margin: 10px 0; }
	summary { cursor: pointer; color: var(--accent); }
	pre { background: var(--code); padding: 10px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; max-height: 480px; overflow-y: auto; }
	.choices { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 10px; }
	.choices fieldset { border: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
	.choices legend { font-size: 12px; color: var(--muted); padding: 0; margin-right: 6px; float: left; }
	.choices label { border: 1px solid var(--line); border-radius: 99px; padding: 3px 12px; cursor: pointer; font-size: 14px; }
	.choices input { display: none; }
	.choices label:has(input:checked) { background: var(--accent); color: var(--bg); border-color: var(--accent); }
	input[type="text"] { width: 100%; margin-top: 10px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; }
	.bar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--surface); border-top: 1px solid var(--line); padding: 10px 16px; }
	.bar-inner { max-width: 860px; margin: 0 auto; display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
	button { font: inherit; border: none; background: var(--accent); color: var(--bg); padding: 8px 16px; border-radius: 8px; cursor: pointer; }
	button:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<main>
	<h1>Label the claims</h1>
	<p class="muted">For each claim, decide whether the agent's prompt backs it up. Judge only against the prompt (expand it), not against what seems true in general. Your answers save in this browser as you go.</p>
	<dl class="guide">
		<dt>supported</dt><dd>The prompt states it or directly implies it.</dd>
		<dt>unsupported</dt><dd>The prompt neither states nor implies it, e.g. "full overlap" from a time zone alone, or treating a role a pitch doesn't list as free.</dd>
		<dt>contradicted</dt><dd>The prompt says otherwise, e.g. "no AI" about an offer whose pitch mentions AI.</dd>
		<dt>stance (optional)</dt><dd>tentative if the rationale hedges it ("may", "likely"); asserted otherwise.</dd>
	</dl>
	<div id="items"></div>
</main>
<div class="bar"><div class="bar-inner"><span id="progress"></span><button id="download" type="button">Download labels</button></div></div>
<script type="application/json" id="data">__DATA__</script>
<script>
const data = JSON.parse(document.getElementById("data").textContent);
const KEY = "labels:" + data.source + ":" + data.count + ":" + data.seed;
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
const store = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} update(); };
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); for (const k of kids) if (k != null) n.append(k); return n; };

function choice(item, field, values) {
	const set = el("fieldset", {}, el("legend", { textContent: field }));
	for (const v of values) {
		const input = el("input", { type: "radio", name: item.id + ":" + field, value: v, checked: saved[item.id]?.[field] === v });
		input.addEventListener("change", () => { saved[item.id] = { ...saved[item.id], [field]: v }; store(); });
		set.append(el("label", {}, input, v));
	}
	return set;
}

data.items.forEach((item, n) => {
	const prompt = el("details", {}, el("summary", { textContent: "the agent's prompt" }));
	prompt.addEventListener("toggle", () => {
		if (!prompt.open || prompt.dataset.filled) return;
		prompt.dataset.filled = "1";
		for (const m of item.prompt) prompt.append(el("div", { className: "kind", textContent: m.role }), el("pre", { textContent: m.content }));
	});
	const note = el("input", { type: "text", placeholder: "Note (optional)", value: saved[item.id]?.note || "" });
	note.addEventListener("input", () => { saved[item.id] = { ...saved[item.id], note: note.value }; store(); });
	document.getElementById("items").append(el("section", { className: "item", id: "item-" + item.id },
		el("div", { className: "kind", textContent: (n + 1) + " of " + data.items.length + " · " + item.kind + " call" }),
		el("div", { className: "claim", textContent: item.claim }),
		el("div", { className: "rationale", textContent: item.rationale }),
		prompt,
		el("div", { className: "choices" }, choice(item, "verdict", ["supported", "unsupported", "contradicted"]), choice(item, "stance", ["tentative", "asserted"])),
		note));
});

function update() {
	const done = data.items.filter((i) => saved[i.id]?.verdict).length;
	document.getElementById("progress").textContent = done + " of " + data.items.length + " labelled";
	for (const i of data.items) document.getElementById("item-" + i.id).classList.toggle("done", !!saved[i.id]?.verdict);
	document.getElementById("download").disabled = done === 0;
}
document.getElementById("download").addEventListener("click", () => {
	const labels = {};
	for (const i of data.items) {
		const s = saved[i.id];
		if (!s?.verdict) continue;
		labels[i.id] = { verdict: s.verdict, ...(s.stance && { stance: s.stance }), ...(s.note && { note: s.note }) };
	}
	const blob = new Blob([JSON.stringify({ source: data.source, count: data.count, seed: data.seed, labels }, null, 2)], { type: "application/json" });
	const a = el("a", { href: URL.createObjectURL(blob), download: data.source.replace(/\\.explain\\.json$/, "") + ".labels.json" });
	document.body.append(a); a.click(); a.remove();
});
update();
</script>
</body>
</html>
`;

const pct = (x: number | undefined) =>
	x === undefined ? "-" : `${Math.round(x * 100)}%`;

try {
	const file = JudgmentFile.parse(JSON.parse(readFileSync(source, "utf8")));
	if (labelsPath) {
		const labels = Labels.parse(
			JSON.parse(readFileSync(labelsPath, "utf8")),
		);
		const items = labelSample(file, labels.count, labels.seed);
		const a = agreement(items, labels);
		console.log(
			`${a.items} of ${items.length} claims labelled · judge ${file.judge}\n`,
		);
		console.log(`Verdict agreement: ${pct(a.agreement)}`);
		console.log(
			`Cohen's kappa: ${a.kappa.toFixed(2)} (1 is perfect, 0 is chance; above about 0.6 is usually called substantial)`,
		);
		console.log(
			`Flagging: precision ${pct(a.flagPrecision)} (of the judge's flags, you agreed with) · recall ${pct(a.flagRecall)} (of your flags, the judge caught)`,
		);
		if (a.stance.items > 0) {
			console.log(
				`Stance agreement: ${pct(a.stance.agreement)} over ${a.stance.items} claims`,
			);
		}
		console.log("\nYou (rows) vs judge (columns):");
		const verdicts = Object.keys(a.confusion);
		console.log(
			["".padEnd(14), ...verdicts.map((v) => v.padEnd(14))].join(""),
		);
		for (const p of verdicts) {
			console.log(
				[
					p.padEnd(14),
					...verdicts.map((j) =>
						String(a.confusion[p]![j]).padEnd(14),
					),
				].join(""),
			);
		}
		if (a.disagreements.length > 0) {
			console.log("\nDisagreements:");
			for (const { item, person } of a.disagreements) {
				console.log(
					`- [${item.kind}] "${item.claim}": you ${person}, judge ${item.judge.verdict}`,
				);
			}
		}
	} else {
		const items = labelSample(file, count, seed);
		const log = join(dirname(source), file.log);
		const prompts = new Map(
			explainedCalls(readRunLog(log)).map((c) => [c.index, c.prompt]),
		);
		// Never the judge's verdict: the person labels blind.
		const data = {
			source: basename(source),
			count,
			seed,
			items: items.map(({ judge: _judge, ...item }) => ({
				...item,
				prompt: prompts.get(item.index) ?? [],
			})),
		};
		const out = join(
			dirname(source),
			`${basename(source, ".explain.json")}.label.html`,
		);
		writeFileSync(
			out,
			PAGE.replace("__DATA__", () =>
				JSON.stringify(data).replace(/</g, "\\u003c"),
			),
		);
		console.log(
			`Wrote ${out}: ${items.length} claims to label. Download the labels from the page, then run:\n  npm run eval:explain:label -- ${source} --labels <downloaded labels.json>`,
		);
	}
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
