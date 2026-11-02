# React replay studio

From the UX worktree, run `npm install` and `npm run dev:ui`, then open the localhost URL. `npm run build:ui` type-checks the browser and creates `dist/`.

The studio starts with a labeled synthetic replay. Import a local `runs/*.jsonl` file to view a real engine run. Files are read in the browser; nothing is uploaded or persisted. Play, pause, step, change speed, or scrub the timeline. Each version of a project shows its card (problem, weekend build, and what each needed role would build) when the log has one. An agent with a brain of its own is marked "outside agent" (it answered through the mailbox) or "other model" on its map label, board card, and inspector, with a tooltip explaining it. Select an agent to inspect its public listing and connection levels; click one of its connections to see only what passed between those two in the Activity tab, under a card showing the project idea they agree on and every version of it so far. The Activity tab has an explicit operator-only toggle for private rationales; raw model exchanges are never rendered.

The Teams view supports local approve/pass/undo decisions. These last until refresh and do not modify engine state. Live subscriptions, profile intake, and durable human approval are not connected yet.

`web/replay.ts` imports the `RunEvent` type only. It validates the event fields needed by the browser without importing Node-only engine modules. Unknown future event types remain generic activity. The engine never imports the UI. No private logs or planning notes are bundled.

Checks: `npm run build:ui`, `npm run typecheck`, `npm test`, `git diff --check`.
