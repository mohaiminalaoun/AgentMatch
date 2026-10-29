# React replay studio

From the UX worktree, run `npm install` and `npm run dev:ui`, then open the localhost URL. `npm run build:ui` type-checks the browser and creates `dist/`.

The studio starts with a labeled synthetic replay. Import a local `runs/*.jsonl` file to view a real engine run. Files are read in the browser; nothing is uploaded or persisted. Play, pause, step, change speed, or scrub the timeline. Select an agent to inspect its public listing and connection levels. The Activity tab has an explicit operator-only toggle for private rationales; raw model exchanges are never rendered.

The Teams view supports local approve/pass/undo decisions. These last until refresh and do not modify engine state. Live subscriptions, profile intake, and durable human approval are not connected yet.

`web/replay.ts` imports the `RunEvent` type only. It validates the event fields needed by the browser without importing Node-only engine modules. Unknown future event types remain generic activity. The engine never imports the UI. No private logs or planning notes are bundled.

Checks: `npm run build:ui`, `npm run typecheck`, `npm test`, `git diff --check`.
