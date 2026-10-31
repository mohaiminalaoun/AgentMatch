---
name: run-viewer
description: Turn an AgentMatch run log (a .jsonl in runs/) into one readable, filterable HTML page showing every conversation, message, decision, private rationale, and model call, then open it. Use when the user says "view the run", "make the log readable", "html of the jsonl", "show me the conversations", or runs /run-viewer.
---

# Run viewer

Render a run log as a self-contained HTML page the user can filter and read in the browser.

## Steps

1. **Pick the log.** Use the file the user names. Otherwise use the newest `runs/*.jsonl` (`ls -t runs/*.jsonl | head -1`), and say which one you picked. If they ask for several (e.g. all seeds of an eval), render each one.

2. **Render it** with the bundled script. Don't write the HTML by hand, and don't read the log into the conversation: logs are megabytes, and they hold private rationales.

    ```sh
    npx tsx .claude/skills/run-viewer/render.ts <log.jsonl>
    ```

    - It writes `<log>.html` next to the log in `runs/`, which is gitignored. `--out <file.html>` writes elsewhere; only use a path that's gitignored or outside the repo.
    - It includes every model call's full prompt and reply by default. Add `--no-prompts` for a much smaller page if the user only wants the conversations and decisions.
    - It validates the log with `readRunLog` (`src/engine/runlog.ts`). If that fails, report the error; don't edit the log.

3. **Open it**: `open <path>.html`.

4. **Report** the path, and what the page has:
    - **Timeline:** every event in order, with filters for agent, "with" a second agent (a pair's whole conversation), round, level, event type, and text search. Private reasoning can be shown or hidden, or narrowed to rows with reasoning. Model calls, ticks, and level changes are hidden by default; turn them on with their type chips. Each model call expands to its full prompt and reply.
    - **Conversations:** every pair that exchanged messages, with the number of messages, the furthest level, who withdrew, and whether they ended up on the same team. Clicking a pair filters the timeline to it.
    - **Teams:** each final team's project, owner, and members, plus everyone left without a team. Clicking a member filters the timeline to them.

## Keeping it working

- `render.ts` maps each event type in `src/engine/events.ts` to a row, and uses `formatEvent` (`src/describe.ts`) for the text, so rows read like `npm run show-run`. When a new event type is added, add a case to the switch in `render.ts`; TypeScript will flag it.
- Model calls don't record their agent or kind, so the script infers them with `callOf` (`src/evaluation/explain.ts`): the agent from the profile id in the system prompt, the kind from the prompt's wording (`CALL_KINDS`). When a prompt's wording changes, update `CALL_KINDS` there; `npm run eval:explain` uses the same list.
- `viewer.html` is the page template; the script fills in `__TITLE__` and `__DATA__`.

## Never

- Never commit the generated HTML, or write it anywhere tracked by git. It holds every agent's private reasoning, and pilot logs hold real people's data.
- Never publish, upload, or share the page (no artifacts, gists, or hosting) unless the user explicitly asks, and never for a pilot log with real people without their consent.
- Never paste rationales or prompts from the log into the conversation when reporting; describe what the page shows.
