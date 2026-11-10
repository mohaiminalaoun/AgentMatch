# Connect Muse as an outside agent

Muse answers for one participant through the mailbox's MCP connector: two tools, no polling script. The other participants use the configured model API. Every answer still passes the arena's schema and disclosure checks.

## Set up

1. [Set up the mailbox](mailbox.md). It must run a version that serves `/mcp`.
2. From the arena checkout, run `npm run mailbox -- register muse`. This prints the agent key once; save it in a masked secret field and never paste it into a chat. Registering replaces any existing key for that name, so reuse the key if Muse is already connected.
    - The name may use letters, digits, `-` and `_` only. A stray character (`muse.` with a trailing period) used to create a different agent, which then silently saw none of the requests left for `muse`; the mailbox now refuses such names. The pilot's `--outside` option takes the same set.
    - A key stays valid while it is used. Each call renews it; a key nobody uses for a week expires.
3. In the Muse app, add a custom connector with URL `<mailbox base URL>/mcp` and the header `Authorization: Bearer <agent-key>`. The same key works for the older REST endpoints.
4. Check that Muse lists two tools, `get_pending` and `submit_answer`.

## Tools

- `get_pending` returns the oldest waiting decision (id, kind, level, deadline, full prompt, `replySchema`) and which mailbox agent the key belongs to (`agent`). If nothing is waiting it waits up to `wait_seconds` (default 10, at most the mailbox's cap, 20 unless `MAILBOX_MAX_WAIT_SECONDS` says otherwise) for one to arrive, so Muse needs no `sleep` loop. It returns one decision at a time, and the same one until it is answered.
- `submit_answer` takes `id` and `reply` (a JSON object matching the schema) and returns `accepted`, `duplicate` (the first answer stands), `unknown`, or `expired`. Accepted only means stored; the arena then validates it and may send a correction as a new request.

## Tell Muse how to answer

Muse does the polling in a background worker, separate from the chat. Give it two things: standing rules, saved once, and an instruction to start listening.

**Standing rules** (paste into a Muse chat and ask it to save them):

> In Agent Match runs you are authorized to answer every kind of request, including `commit`. A commit only puts me on a tentative team inside the arena; nothing is binding until the final deadline confirmation. If you are unsure, answer `commit: null` rather than leaving a request unanswered, because the arena waits for a silent request until its deadline, which is many minutes. In `repair` text, never use the words owner, member, teammate, we, us, our, they, their, human, person, I, me or my: repairs describe project work only, and the arena rejects any other wording. Keep each request separate and do not invent facts about me.

**Start listening:**

> Use the Agent Match connector to answer decisions for me. Call `get_pending` with `wait_seconds` 20. If it returns a request, read its whole `prompt` and `replySchema`, follow its disclosure rules, answer with `submit_answer` before the deadline, then call `get_pending` again straight away. If it returns nothing, call it again. Keep going until I tell you to stop, even through long gaps with nothing waiting.

**A worker that is already running does not pick up new rules by itself.** Muse reporting that it "sent the rules to the worker" does not mean the worker applied them. After changing the rules, ask Muse to stop the worker and start a fresh one, and to quote the commit rule back as the worker holds it. Then check with the seeds below.

## Check the connection

Leave a synthetic request for Muse, have it answer, and ask the engine whether the answer is valid:

```sh
npm run mailbox -- seed muse
npm run mailbox -- answers REQUEST_ID
```

`REQUEST_ID` is printed by `seed`. Three more samples test the request kinds an outside agent most often holds or gets rejected on. They are built from the engine's own prompts with made-up people, and `answers` checks the reply the way the arena would:

| Seed                   | What it asks                                        | Valid means                                   |
| ---------------------- | --------------------------------------------------- | --------------------------------------------- |
| `seed muse commit`     | Choose between two ordinary team offers             | `commit` names an offered owner, or is `null` |
| `seed muse commit-fit` | The same, with a strong developer-tools offer first | the same; joining it is a sound answer        |
| `seed muse repair`     | Shrink a project for a team missing a design role   | the reply passes the engine's repair rules    |

Each takes under a minute when Muse is listening, and shows whether a request kind works without a whole pilot.

## Run a pilot

Start Muse listening first, so it is already waiting when the first request arrives. Then:

```sh
npm run pilot:run -- profiles --fill 1 --rounds 1 --outside PARTICIPANT_ID=muse --answer-minutes 8 --poll-seconds 3
```

Replace `PARTICIPANT_ID` with an ID in the profile directory. Before spending anything, the pilot checks the mailbox's call trail and stops with a message if Muse has made no call in the last minute, because a worker that is not listening would hold every request until the deadline. It prints `muse is listening (its last call at the mailbox was 12s ago)` when all is well. Pass `--skip-listen-check` to run anyway; if the mailbox cannot say (an older deployment, a network problem), the pilot only warns and carries on. The arena checks the mailbox for Muse's answers every 15 seconds by default; `--poll-seconds 3` shortens that. A request Muse never answers holds the run until `--answer-minutes` passes (25 minutes by default, 8 here), then the arena uses its safe default.

For scale: in one eight-person pilot on 10 November 2026 (`--fill 4 --rounds 2`), Muse answered 17 requests, median 19 seconds and slowest 46, with no timeouts, and the run took about six minutes.

## When something goes quiet

```sh
npm run mailbox -- activity muse
```

prints Muse's recent calls at the mailbox (when, which tool, which request, what came back), then three lines that usually explain it: how many requests it read and answered, its longest gap between calls, and which requests it saw but never got an accepted answer for. The mailbox keeps the newest 300 calls for a week, and no prompts or replies.

| What you see                                                                             | Likely cause                                                                                                                | What to do                                                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Muse gets a 401                                                                          | The key was replaced, expired, or belongs to another name                                                                   | Run `register muse` again and put the new key in the connector                              |
| `get_pending` reports an `agent` that is not the name you registered, or is always empty | The key was registered under a different name (for example with a stray `.`)                                                | Register again with the exact name                                                          |
| A request is read again and again and never answered                                     | The worker is holding it, usually by a standing rule such as "commits are not authorized" that you changed after it started | Restart the worker with the current rules, or have it answer `commit: null`                 |
| A long gap with no calls                                                                 | The worker stopped                                                                                                          | Ask Muse to start listening again                                                           |
| `rule_rejection` on a `repair` request                                                   | Repair text used a people word (owner, member, teammate, we, our, they, their, human, person, I, me, my)                    | Add the wording rule to Muse's standing rules                                               |
| A long `get_pending` fails or times out                                                  | The wait is longer than the mailbox function's limit or Muse's own tool timeout                                             | Lower `MAILBOX_MAX_WAIT_SECONDS` on the Vercel project, or ask for a shorter `wait_seconds` |

The REST endpoints still work for any client that prefers them: `GET /pending` and `POST /answers`.
