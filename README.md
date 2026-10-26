# Agent Match


Agent Match is a network of personal AI agents that form teams on behalf of their humans.

Instead of people hunting for teammates, each person gets an agent that knows their skills, interests, project ideas, availability, and working preferences. The agents find each other, negotiate, and propose teams. Humans only approve or reject the final recommendations.

## Status

Early stage. This repository currently holds the project brief and this README. No code has been written yet.

## How it works

Each agent does five things:

- **Discover:** finds people with complementary skills and shared interests.
- **Negotiate:** discusses project ideas, roles, tech stacks, and potential conflicts through structured proposals.
- **Coordinate:** handles competing offers, availability changes, and team size or skill requirements.
- **Adapt:** re-evaluates matches as new people join or circumstances change.
- **Recommend:** presents the best team combinations for human sign-off.

## The engineering challenge

Get 30-50 autonomous agents to negotiate at the same time, with conflicting proposals and no central coordinator, and still converge on good teams. This is why the system needs high throughput and a high rate limit.

## Planned architecture

- **Reasoning engine:** Meta's open-weight model, Muse Spark Open, runs every agent. It handles tool calling, structured proposals, and multi-round negotiation.
- **Inference hosting (undecided):**
  - **Baseten:** managed endpoint, 2M TPM.
  - **Modal:** self-deployed on serverless GPUs, for example with vLLM.
  - The choice depends on which credits are granted. Meta's $150 in credits is the baseline.

## Privacy-preserving matching

Agents negotiate without revealing raw profiles. They disclose only what is needed, one round at a time.

Example: Agent A proposes a web app startup to Agent B. B's human wants to start a climate-change non-profit, so B declines and reveals nothing about its profile. A learns nothing it had no reason to know.

- **Staged disclosure.** Each round reveals only the next level of detail, and only if the other side's last answer justified it:
  - Level 0: a one-line project pitch and the roles needed.
  - Level 1: general interest area and availability.
  - Level 2: skills and constraints.
  - Level 3: specifics, only after mutual interest.
- **Counter-proposals over flat declines.** B can decline the startup but counter with "I'd consider building the platform for a climate project", which discloses a little in exchange for a possible match.
- **Uninformative refusals.** A decline like "not a fit right now" avoids leaking B's goals unless revealing more helps B's human.
- **Disclosure gate outside the model.** The agent drafts a message, and a deterministic layer checks which profile fields it touches and blocks anything above the current level. The guarantee does not depend on the LLM following a prompt.
- **Measurable privacy.** For each agent, count profile fields disclosed to people who ended up on different teams. Plot match quality against information leaked, with full-profile broadcast as the baseline.
- **Threat to name:** fishing, where an agent sends fake proposals to see who bites. Mitigate by limiting proposals per round and checking consistency.

## Differentiators

- **Structured negotiation with hard constraints.** Agents exchange structured proposals rather than chatting politely.
- **Baseline comparison.** A metric compares agent-formed teams against random and greedy matching.
- **Privacy vs. quality.** A chart shows match quality against information leaked, compared with full-profile broadcast.
- **Live visualization.** Shows agents proposing, countering, and clustering.
- **Human approval step.** Sign-off is a prominent part of the flow, not an afterthought.
- **Demo video.** A polished 3-minute demo, since judges score from it.

## Positioning

- **Track:** Indie, aiming for first place ($150K).
- **Bonus prizes in view:** Best Agentic Use-Case, Best Build on Meta Open Weights, Community Vote, Most Viral.
- **Proof case:** this hackathon's participants, ideally with real people using it before Nov 4.
- **Longer-term vision:** the same engine could find like-minded groups inside companies for projects, startup spinouts, networking, and mentorship. The open-weight model lets sensitive employee data stay on the company's own infrastructure.

## Open questions

- Final project name.
- Baseten or Modal, depending on which credits come through.
- How much of the company-internal version to demo versus mention as vision.
