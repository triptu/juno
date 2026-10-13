# Juno Agent: owner's brief

Written down from the owner's request (10-14). This is the input for the research and plan. Plain restatement, not a design.

- **A standalone, portable agent.** Juno chat is its own module, not tied to the Slack client. It could later run as its own app or be embedded in other apps, and it is the same assistant, with the same state, synced everywhere. State lives in SQLite or similar.
- **Library.** Use pi's latest version, which has durability and MCP support built in.
- **Connections (MCP).** T3 Code's MCP (so the owner can ask Juno to fix something in Juno and it orchestrates a T3 Code session to do it, while keeping the owner proactively updated), Littlebird's MCP, Notion, and more over time.
- **Interface.** Message bubbles, like iMessage, so it feels personal. The main chat stays simple: no visible tool calls or machinery. Steering, subagent delegation and complex work are abstracted away behind the conversation.
- **Long-running, infinite chat.** One persistent conversation. Follow the "optmem" architecture: https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449
- **Memory.** Follow the same gist, with formal verification in place (the project already uses Quint for sync protocols).
- **Model providers.** OpenRouter, plus the user's local Codex or Claude Code subscription for the chat itself, configurable in settings.
- **Proactive.** It can set cron-like schedules for itself to be proactive or to notify about something.
- **Tools.** Send OS notifications, do work on the owner's behalf (with confirmation where needed), and render action cards from JSON (something like json-render) for actions, as the product spec's confirm cards describe.
- **Process.** Its own workstream. Opus researches and plans; Astra and Fable look into the material separately, review, help refine, and write code.

Related existing material: `docs/design/handoff/SPEC.md` sections 12 (For you), 13 (Juno, the assistant) and 15 (AI system); `docs/architecture.md` AI section; `packages/ai` (the current AI provider and tasks); `docs/decision-log.md`.
