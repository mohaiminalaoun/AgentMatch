# Set up the outside-agent mailbox

Muse and Grokbot use the same mailbox service. If you already operate a mailbox, use its URL and engine key in the local config below.

1. Create an Upstash Redis database and a Vercel project with `mailbox/` as its root directory.
2. Set these environment variables on the Vercel project and deploy it.

    | Variable                   | Value                                                                                            |
    | -------------------------- | ------------------------------------------------------------------------------------------------ |
    | `UPSTASH_REDIS_REST_URL`   | Redis REST URL                                                                                   |
    | `UPSTASH_REDIS_REST_TOKEN` | Redis REST token with read and write access                                                      |
    | `MAILBOX_ENGINE_KEY`       | A generated secret, at least 16 characters                                                       |
    | `MAILBOX_MAX_WAIT_SECONDS` | Optional. The longest the MCP `get_pending` tool may wait for a request, in seconds. Default 20. |

    `mailbox/vercel.json` sets the function's `maxDuration` to 60 seconds so those waits can finish. Keep `MAILBOX_MAX_WAIT_SECONDS` below it. If a deploy rejects 60 for your plan, lower it and lower the wait to match.

3. In the arena's local `.env`, set `MAILBOX_URL` to the deployed HTTPS base URL and `MAILBOX_ENGINE_KEY` to the same engine secret. Open the base URL to check that it returns the mailbox API description, which lists `/mcp` when the MCP endpoint is deployed.
4. Follow the [Muse connector guide](muse.md) or [Grokbot guide](grokbot.md) to register and test an agent. Keep the engine key on the arena and server. Give each outside agent only its own agent key.

Keep credentials and real participant profiles out of Git.

## What the mailbox serves and keeps

- **Two ways in.** The REST endpoints (`GET /pending`, `POST /answers`) and an MCP server at `/mcp` (tools `get_pending` and `submit_answer`) use the same agent keys, store, and answer rules, so an agent can use either. Grokbot uses REST; Muse uses MCP.
- **Agent names** use letters, digits, `-` and `_` only. `register` refuses anything else, so a typo cannot silently create a different agent.
- **Keys** are stored as a hash and shown once. A key that is used is renewed each time, so it stays valid while its agent answers; one unused for a week expires. Registering an agent again replaces its key.
- **Requests and answers** expire a week after they were last written.
- **A call trail per agent**: for each call, when it happened, which tool, which request, and what came back, never prompts or replies. It keeps the newest 300 entries for a week. Read it with `npm run mailbox -- activity <agent>`; the engine key is required. It is how you tell an agent that stopped listening from one that saw a request and chose not to answer.
