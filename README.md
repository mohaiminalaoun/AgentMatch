# Agent Match

A network of personal AI agents that form teams on behalf of their humans.

Instead of people hunting for teammates, each person gets an agent that knows their skills, interests, project ideas, availability, and private notes. The agents find each other, negotiate, reshape project ideas together, and form groups, with no central coordinator and no one seeing anyone's full profile. At a deadline, everyone confirms their group or drops out, and only then are names exchanged.

> **Status:** works end to end. Evaluated on synthetic people against classic matching baselines, and piloted with a small group of real people.

## Why

Forming a team usually means one of two things: hand everything to a central matcher that sees every profile, or post publicly and search by hand. Agents can do the searching and negotiating for you, privately, revealing only as much as each conversation has earned.

## How a team forms

1. **Listing.** Each agent writes a public board listing for its human: a short title, a pitch, and the roles the project needs. Only the project idea is public.
2. **Discovery.** Each agent reads the board and picks up to three people to approach.
3. **Negotiation by level.** The other agent accepts, declines, or counters. Each accepted step opens the next disclosure level, where both sides share that level's fields and decide whether to continue or withdraw.
4. **Reshaping the idea.** At levels 1 and 2, either side may propose a reshaped version of the project. The other adopts it or keeps the current one. Every version carries its own title, so adopting a version adopts its name.
5. **Groups.** Project owners offer places to the people they're ready with. An owner who is also offered a place first decides whether to lead its own group or join the other. Offers settle by deferred acceptance, and an offer is only sent if it reveals nothing the owner learned from someone else. Groups stay tentative: they keep recruiting, and post their current version and still-open roles on the board, until the deadline.
6. **Brainstorm.** People still without a group after things settle can meet each other with no idea yet and build one together.
7. **Scope repair.** Before final confirmation, each tentative team with uncovered required roles gets one opportunity to propose a smaller build. Every removed role needs a concrete work change, remaining roles must have known coverage, and every member must approve. A rejection or failed response keeps the original project. Recruitment is not reopened.
8. **The deadline.** Each member is asked whether they're confident in their group. Anyone who isn't drops out; if the group changed, the rest are asked once more. Groups of two or more become teams.
9. **Names last.** Teammates swap names only after the deadline, and in the pilot only after people approve.

Agents never call each other. Every message goes through a bus that validates it, and every step is emitted as an event, so a run can be replayed later as a timeline.

## How agents decide

Early versions let each prompt carry its own rule of thumb, and agents explained decisions with claims their prompts didn't support. Now:

- **One standard.** Every decision, from whom to approach to whether to stay at the deadline, is judged by the same definition of a good team: a project the human wants, a grounded reason for each person to participate, feasible collaboration, essential work covered by people with the time, and the human's skills in use. Exploration can leave questions open; final confirmation judges the actual roster.
- **Computed facts, labelled.** Code works out what it can from the agent's own profile and what the other side has shared: time zones and each side's evening on the other's clock, hours, skills, the team sizes that suit both. Actual work schedules and synchronous collaboration needs remain unknown unless stated; time-zone differences alone do not establish a conflict. Rationales must rest on the facts and never state an unknown as fact.
- **Code checks claims and decisions.** A reshaped project must say who covers each role, checked against the profiles. Offers give each chosen person a different role. An owner bringing people together sees how they fit each other, not just itself. A private hunch must cite the note it rests on, or it counts for nothing.
- **Every override is logged.** When code drops someone the model chose, or someone never becomes an offer, the run log says who and why.

## Privacy by design

Profiles are revealed in stages:

| Level | What's shared                     |
| ----- | --------------------------------- |
| 0     | Project idea (the public listing) |
| 1     | Interests and availability        |
| 2     | Skills and team preferences       |
| 3     | Name (only after the deadline)    |

- **A deterministic gate, outside the model,** checks every outgoing message and blocks anything that reveals more than the current level allows. Privacy doesn't depend on the model following instructions.
- **Private notes are kept out of prompts until their level opens.** The gate can find a profile value in a message, but not a paraphrased note, so a note that isn't in the prompt can't leak.
- **"Never" notes only steer.** A separate private call sees them, but can only output a fixed steer (neutral, explore, careful, stop) that code turns into a fixed sentence.
- **Reasoning stays private.** Each decision's rationale is logged for its own human and never sent.

## Results

Each method matches the same generated people (20 per run, 5 seeds), scored on team quality (skill coverage, shared interests, and working-hours overlap, equally weighted), the share of people placed, per-person quality (unplaced people count as zero), and **leakage**: the share of private profile fields that reached someone outside their own team.

| Method       | Team quality | Worst team | Placed | Per person | Leakage | Trusted party |
| ------------ | ------------ | ---------- | ------ | ---------- | ------- | ------------- |
| Random       | 0.340        | 0.160      | 100%   | 0.343      | 0%      | needed        |
| Greedy       | 0.546        | 0.344      | 100%   | 0.532      | 0%      | needed        |
| Local search | 0.600        | 0.404      | 100%   | 0.589      | 0%      | needed        |
| Broadcast    | 0.600        | 0.404      | 100%   | 0.589      | 87.4%   | none          |
| **Agents**   | **0.553**    | 0.258      | 87%    | 0.489      | 10.1%   | none          |

- **Random** shuffles everyone into teams: the floor. **Greedy** builds teams one at a time, adding whoever raises the score most. **Local search** improves greedy's teams by swapping people while any swap helps. **Broadcast** has everyone post their full profile, then runs local search: the best you can do by sharing everything.
- **Every baseline needs a trusted party** that sees every profile, or everyone revealing everything. The agents need neither, and leak about a tenth of what broadcasting does.
- **The agents' teams score above greedy's,** with much higher shared interest (0.856 against 0.656), but lower skill coverage (0.431 against 0.546) and working-hours overlap (0.372 against 0.438).
- **13% of people end with no team,** so per-person quality is below greedy's. Reading the logs, most of them are people whose agents turned down projects outside their stated interests, or beginners others passed on. A matcher places everyone; agents act for their humans and can say no.
- **Explanations:** a judge model sorted every claim in a sample of 254 private rationales: 96.5% were supported by what the agent was told, 3% unsupported, 0.5% contradicted. The judge agreed with a person's hand labels on 87% of 30 claims (Cohen's kappa 0.72).
- **Known failures, replayed:** 12 fixed scenarios replay mistakes seen in earlier runs (inventing a schedule, misreading roles, judging a forming team as final, ignoring a 10-hour time-zone gap). In the frozen run, 11 never failed in 10 tries and one failed 2 in 10.
- **Since the first version** (`results/baseline-2026-10-30.json`), per-person quality went from 0.414 to 0.489, placement from 82% to 87%, leakage from 14.8% to 10.1%, and supported claims from 91% to 96.5%.

![Per-person team quality against leakage](results/chart.svg)

The numbers are frozen in `results/baseline-after-groups.json`, from runs on a low-cost model that may only see synthetic people.

## Pilot with real people

The same system runs on real people with `pilot:run`: each person is one JSON file (profile, level-tagged notes, and contact details that never enter a prompt), optionally mixed with generated people so the board isn't too thin.

- Real profiles are only ever sent to a model that doesn't train on its inputs. The command refuses any other.
- Names stay hidden even after a team forms, until people approve.
- Each person can see only their own view of a run: the public board, their own agent's steps and reasoning, and messages to or from them (`pilot:view`).
- In two runs with four real people and four generated ones, every real person ended on a team and confirmed it at the deadline, and the judge found 97–98% of claims in the agents' reasoning supported and none contradicted.

## Limits

- **The evaluation uses synthetic people,** and the real-people pilot is small.
- **The quality score is an approximation.** Shared interest counts exact words, so related topics don't count, and overlap assumes everyone works 9 to 5 in their own time zone, which agents are told is an assumption.
- **The gate catches known profile values, not meaning.** That's why notes stay out of prompts rather than relying on the gate.
- **Model choices vary from run to run,** so results are averaged over seeds.
- **Runs cost real model calls:** roughly 100–200 per 10 people.
- **In the pilot, the operator is trusted** and can see everyone's data and logs.
- **Commitment isn't a message protocol yet.** It reads agent state directly, so bringing your own agent is future work.

## Try it

Copy `.env.example` to `.env` and set an OpenAI-compatible endpoint, key, and model. Then:

- `npm run simulate` runs the whole system on generated people and prints every event.
- `npm run eval` compares the baselines; `npm run eval:agents` adds the agents; `npm run chart` draws the chart.
- `npm run eval:explain -- <log>` judges a run's explanations; `npm run regressions` replays the known failures; `npm run eval:decisions -- <log>` checks finished teams for hard problems.
- `npm run dev:ui` opens the replay UI: load a run log from `runs/` to see the board, each conversation, and how each team's idea and members came together. The people page adds pilot profiles by paste or upload.
- `npm run pilot:run -- profiles/ --fill 4` runs real people from `profiles/` (gitignored; copy `profiles/example.json`), and `npm run pilot:view -- <log> <id>` shows one person's view.

[CLAUDE.md](CLAUDE.md) lists every command.

## Architecture

- `src/engine`: agents, the bus, the disclosure gate, negotiation, discovery, and commitment. It never imports from the UI or the pilot.
- `src/evaluation`: synthetic people, baselines, and metrics.
- `src/ui`: a terminal UI and a browser replay UI, both built on the engine's events.
- `src/pilot`: running real people, and what each person may see.

## Tech

- TypeScript and Node.js, with zod schemas for every message and model output
- LLMs served through an OpenAI-compatible endpoint
- React and Vite for the replay UI, Ink for the terminal UI
- Vitest

## License

MIT. See [LICENSE](LICENSE).

## External Grokbot agent

Grokbot can answer for one participant through a webhook-triggered routine. The arena stores each full request in the authenticated mailbox, sends only its ID to the routine, then validates the returned answer with the same schema and disclosure checks as internal agents. No scheduled worker is needed.

See [Grokbot setup and routine instructions](docs/grokbot.md). With credentials configured locally:

```sh
npm run pilot:run -- profiles --cast 14 --rounds 4 --outside p-bwwbwk=grokbot --answer-minutes 8
```

Replace the participant ID with one present in your profile directory. This command makes paid model calls. Grokbot answers are checked every two seconds by default; use `--poll-seconds 5` for less frequent mailbox checks. Other outside agents retain the 15-second default.

### Bounded pre-deadline repair

Repair preserves the roster and original user problem. It does not merge teams, relax minimum team sizes, or silently declare work optional. The owner can make one proposal (at most two validation attempts); each member, including the owner, gets one approval attempt. Only unanimous approval updates the stored project card and role requirements. Final confidence is still checked independently afterward. Missing or invalid answers fail closed to the original project.

Repair prompts use each agent's own profile and only facts it has learned. The proposal is checked against owner disclosure rules and third-party leakage before any teammate reads it; voting rationales stay private. Code checks role changes and known coverage, but whether the proposed simplification really solves the user problem remains an agent judgment, not a proven fact. No live matching improvement is claimed until this is evaluated on a new run.
