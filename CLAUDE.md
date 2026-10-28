# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test`: run all tests once (Vitest)
- `npx vitest run tests/engine/profile.test.ts`: run one test file; add `-t "<test name>"` to run one test
- `npm run test:watch`: run tests in watch mode
- `npm run typecheck`: type-check with `tsc --noEmit` (nothing is emitted; code runs through `tsx`)
- `npm start`: run `src/index.ts` with `tsx`
- `npm run eval`: compare all matching methods across seeds and print a results table (`src/evaluation/run.ts`)
- `npm run ask "<prompt>"`: send one prompt to the model configured in `.env` and print the reply, token usage, and latency (`src/ask.ts`; costs real credits)
- `npm run decide [1-5]`: one agent decides on one sample proposal from `src/scenarios.ts`, printing the messages, its private rationale, gate blocks, and what would be sent (`src/decide.ts`; costs real credits)
- `npm run reliability`: run 20 live agent decisions concurrently over `src/scenarios.ts` and report the decision mix, gate blocks, a re-check that nothing sent breaks the disclosure rules, tokens, and time (`src/reliability.ts`; costs real credits)
- `npm run round`: one live round on the bus (Ivan proposes to Ben; Ben's agent decides and replies), printing each bus event, the private rationale, and both agents' state (`src/round.ts`; costs real credits)
- `npm run negotiate`: Nia proposes to Kemi and the two negotiate over the bus tick by tick up to level 2, printing every message, levels after each tick, every private rationale, and what each side learned (`src/negotiate.ts`; costs real credits)
- `npm run discover`: the six sample people's agents write board listings, then pick whom to approach; prints the listings, the board, each choice with its private rationale, and the resulting proposals, without negotiating (`src/discover.ts`; costs real credits)
- `npm run simulate [-- --agents N --rounds R --seed S --private]`: the whole system on generated people (default 10 agents, 2 rounds, seed 1): listings, then discovery and negotiation each round, all concurrent; prints every event as it happens (private rationales only with `--private`), a live status line of model calls, tokens, and time, and a report (pairs reached, never-approached agents, roles beyond the core four on the board, gate blocks, calls, tokens) (`src/simulate.ts`; costs real credits, roughly 60–120 calls)
- `npm run load-test [count]`: fire `count` (default 50) calls at once through the queued, retrying client and report 429s, retries, peak concurrency, and speedup (`src/load-test.ts`; costs real credits)
- `npm run show-run [file] [--prompts]`: print a run log from `runs/` as a timeline (ticks, bus messages, decisions and interest checks with their private rationales, level changes, and a model-call summary), defaulting to the newest; `--prompts` prints every model call in full. Logs are `runs/<timestamp>-<label>.jsonl`, one run event per line, gitignored because they hold every agent's private rationale and can hold real people's data
- `npm run format` / `npm run format:check`: run Prettier (tabs, width 4)

## Architecture

Agent Match is a network of personal AI agents that negotiate to form teams for their humans, with no central coordinator. Agents reveal profile information in stages, and a deterministic disclosure gate outside the LLM blocks any message that reveals more than the current stage allows. Privacy must never depend on the model following instructions.

The code lives in `src/` in three areas:

- `src/engine`: core agent logic (domain schemas, proposals, the disclosure gate, the LLM client). LLM calls layer as `createLlmClient` (concurrency limit via `queue.ts`, backoff on 429/5xx via `backoff.ts`) → `chatJson` (re-asks on invalid JSON) → `chat` (one HTTP request); agents should share one client. Agents decide through `decideOnProposal` (`decision.ts`), which runs every outgoing message through the disclosure gate (`gate.ts`); the model's `rationale` stays private and is never sent. Agents never call each other: every message goes through the bus (`bus.ts`), which validates it (schema, sender identity, recipient), delivers a copy to the recipient's inbox, and reports numbered events to subscribers for logging, the UI, and replay. `runRound` (`round.ts`) sends new proposals, then runs ticks until no mail is waiting (or `maxTicks`): each tick every agent handles its whole inbox, model calls run concurrently, and replies go out in inbox order so the bus order doesn't depend on LLM timing. An accepted proposal or counter opens level 1, and both sides send a `share` of that level's fields, built by code from the profile and gate-checked; receivers `learn` it, then run an interest check (`interest.ts`) and send `continue` or `withdraw`, which carry no text. Once both sides have continued at a level, the next opens, up to `maxLevel` (default 2; level 3, names, is for commitment). Each agent's model first writes its public board listing (`listing.ts`): a pitch from its project idea plus the roles the project needs from others (any of `ROLES`), gate-checked at level 0. `runSimulation` (`simulation.ts`) chains it all: listings once, then each round `discover` → `runRound`; `summarize` derives the report from the final world and the events. Agents then choose whom to approach through `discover` (`discovery.ts`): each sees its own profile plus the public board (every agent's listing, nothing more), picks up to 3, and picks become proposals for `runRound`. `runRound`'s `onEvent` emits one ordered stream of run events (`events.ts`: round, tick, bus, decision, interest, level, exchange); scripts write it to the run log and print it with `formatEvent` (`src/describe.ts`), so live output matches `show-run`. **It must never import from `src/ui`.** The UI subscribes to events the engine emits.
- `src/evaluation`: synthetic profiles, non-LLM baselines, and metrics (team quality, privacy leakage).
- `src/ui`: an Ink terminal UI that renders engine events.

Domain types are zod schemas, and each TypeScript type comes from its schema with `z.infer`, using the same name (`export const Profile = z.object(...)` and `export type Profile = z.infer<typeof Profile>`). Validate any untrusted data, including LLM output, against these schemas. Tests live in `tests/`, which mirrors the `src/` layout (`src/engine/profile.ts` → `tests/engine/profile.test.ts`). Shared test data goes in `tests/fixtures.ts`.

## Conventions

- ESM with `NodeNext` resolution: relative imports need a `.js` extension (`import { Profile } from "./profile.js"`).
- LLM settings (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) live in a gitignored `.env`; copy `.env.example` to create it. Entry points call `readEnvFile()` once, then pass `loadConfig(process.env)` down to whatever needs it. Never log the config or the API key.
- Optional `LLM_PRICE_*` settings (USD per million tokens) let reports estimate cost (`cost.ts`). The `-contributor` models are about 95% cheaper because the provider trains on their inputs: use them only with synthetic profiles, never with real people's data.
- Optional `LLM_REASONING_EFFORT` (`minimal`, `low`, `medium`, `high`) is sent as `reasoning_effort`. Hidden reasoning was about 95% of output tokens in simulations; `minimal` cut one decision from 25s to 2.5s.
- The tsconfig is strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. Use `import type` for type-only imports.
- `steps.md` (the build plan), `readme-inprogress.md` (strategy notes), and `demo-notes.md` (demo moments and transcripts) are private and gitignored. Never commit them or copy their contents into tracked files. Work through `steps.md` one step at a time unless asked to combine steps.
- Use the `/commit-changes` skill for commits: one-line Conventional Commits messages, with no attribution lines.
