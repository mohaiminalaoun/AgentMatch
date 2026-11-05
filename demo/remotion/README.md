# Demo video scenes (Remotion)

Animated scenes and overlays for the hackathon demo video, rendered at
1920x1080, 30fps. Remotion controls framing and time; the scenes reuse the app's
`AgentCharacter` and `IdeaTimeline` components and stylesheet. CSS animations are
disabled during rendering to keep frames deterministic.

Compositions:

- `StagedDisclosure`, `ProjectEvolution`, `ResultCard`: the app's own components
  (disclosure lights, the recorded Invoice Back Office -> Chat Ledger revision,
  the confirmed team).
- `ArenaAgentSlide`: creating an arena agent (syntax-highlighted profile JSON).
- `StagedDisclosureSlide`: disclosure levels L0-L3 with the gate blocking each step.
- `CommitmentSlide`: tentative group, both confirm, humans approve, names shared.
- `ArenaPrivacy`: separate agents, the deterministic gate, a recorded gate block,
  a private "hunch" from a never note, and the early reliability check.
- `EvalHarness`: privacy vs. quality scatter plus judge, regression and baseline cards.
- `TeamsOverlay`: transparent overlay (ProRes 4444 / WebM alpha) with pilot teams forming.

Data: project data is an explicit public-field extraction from
`runs/2026-11-03T17-57-10-749Z-pilot.jsonl` (regenerate from the repository root
with `npx tsx demo/remotion/scripts/extract-public.ts`). The eval scene embeds
aggregates from `results/baseline-*.json`. The privacy scene quotes recorded
messages from the (made-up) pilot cast. No private profiles, instructions or
prompts are bundled. Numbers shown are from one pilot run and a synthetic
benchmark, not general success rates.

From the repository root:

```sh
npm install --prefix demo/remotion
npm run studio --prefix demo/remotion
npm run typecheck --prefix demo/remotion
npm run render --prefix demo/remotion
```

Outputs: `runs/remotion-inserts/*.mp4` (1920×1080, 30fps).
Dependencies are isolated in this package. Local Chrome is used when installed.
