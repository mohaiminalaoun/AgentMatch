# Agent Match

A network of personal AI agents that form teams on behalf of their humans.

Instead of people hunting for teammates, each person gets an agent that knows their skills, interests, project ideas, and availability. The agents find each other, negotiate, and propose teams. Humans approve or reject the final recommendations.

> **Status:** early development. Not usable yet.

## How it works

Each agent:

- **Discovers** people with complementary skills and shared interests.
- **Negotiates** project ideas, roles, and tech stacks through structured proposals.
- **Coordinates** competing offers, availability, and team size.
- **Adapts** as new people join or circumstances change.
- **Recommends** the best teams for its human to approve.

There is no central coordinator. Dozens of agents negotiate at the same time and converge on teams.

## Privacy by design

Agents don't share full profiles. They reveal information in stages, and only when the other side has shown real interest.

For example, if someone's agent pitches a web app startup to an agent whose human wants to start a climate non-profit, the second agent declines without revealing anything about its human.

A deterministic disclosure gate sits outside the model and blocks any message that reveals more than the current stage allows. The privacy guarantee doesn't depend on the model following instructions.

## Tech

- TypeScript and Node.js
- Open-weight LLMs served through an OpenAI-compatible endpoint
- A terminal UI built with Ink

## License

TBD
