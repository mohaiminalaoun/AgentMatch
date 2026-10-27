# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test`: run all tests once (Vitest)
- `npx vitest run tests/engine/profile.test.ts`: run one test file; add `-t "<test name>"` to run one test
- `npm run test:watch`: run tests in watch mode
- `npm run typecheck`: type-check with `tsc --noEmit` (nothing is emitted; code runs through `tsx`)
- `npm start`: run `src/index.ts` with `tsx`
- `npm run eval`: compare all matching methods across seeds and print a results table (`src/evaluation/run.ts`)
- `npm run format` / `npm run format:check`: run Prettier (tabs, width 4)

## Architecture

Agent Match is a network of personal AI agents that negotiate to form teams for their humans, with no central coordinator. Agents reveal profile information in stages, and a deterministic disclosure gate outside the LLM blocks any message that reveals more than the current stage allows. Privacy must never depend on the model following instructions.

The code lives in `src/` in three areas:

- `src/engine`: core agent logic (domain schemas, proposals, the disclosure gate, the LLM request queue). **It must never import from `src/ui`.** The UI subscribes to events the engine emits.
- `src/evaluation`: synthetic profiles, non-LLM baselines, and metrics (team quality, privacy leakage).
- `src/ui`: an Ink terminal UI that renders engine events.

Domain types are zod schemas, and each TypeScript type comes from its schema with `z.infer`, using the same name (`export const Profile = z.object(...)` and `export type Profile = z.infer<typeof Profile>`). Validate any untrusted data, including LLM output, against these schemas. Tests live in `tests/`, which mirrors the `src/` layout (`src/engine/profile.ts` → `tests/engine/profile.test.ts`). Shared test data goes in `tests/fixtures.ts`.

## Conventions

- ESM with `NodeNext` resolution: relative imports need a `.js` extension (`import { Profile } from "./profile.js"`).
- LLM settings (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`) live in a gitignored `.env`; copy `.env.example` to create it. Entry points call `readEnvFile()` once, then pass `loadConfig(process.env)` down to whatever needs it. Never log the config or the API key.
- The tsconfig is strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. Use `import type` for type-only imports.
- `steps.md` (the build plan) and `readme-inprogress.md` are private and gitignored. Never commit them or copy their contents into tracked files. Work through `steps.md` one step at a time unless asked to combine steps.
- Use the `/commit-changes` skill for commits: one-line Conventional Commits messages, with no attribution lines.
