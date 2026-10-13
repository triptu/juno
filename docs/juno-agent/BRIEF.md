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

## Owner decisions on plan v1 (10-14 01:59)

- Providers: Codex (local) and OpenRouter. Sign in with ChatGPT if feasible. No Claude Code subscription provider (terms risk).
- Proactive messages only about what the owner set up: reminders and schedules he asked for, progress and results of work he started, and things he told Juno to watch. No unsolicited observations.
- Sync v1: one writer (the Mac), encrypted backup, and a way to move ownership. Multi-device live sync later if needed.
- No confirmation click needed for: read-only lookups (Slack, Notion, Littlebird, topics, T3 Code status), OS notifications to the owner, scheduling its own wakeups, and starting T3 Code sessions when asked. Everything else outward is a card and runs at most once after a click.
- Still open: how an outside app connects to T3 Code's MCP, Littlebird MCP's endpoint/auth/tools, the compaction model, and a daily spend cap (orchestrator to propose defaults).

## MCP endpoints (from the owner, 10-14)

- Littlebird: `https://mcp.littlebird.ai/mcp`, a custom MCP server with OAuth.
- T3 Code: `http://192.168.1.22:3773/mcp`, a custom MCP server that connects without extra auth. It is plain HTTP on the local network, so Juno should prefer the loopback address when T3 Code runs on the same machine, make the URL a setting, and never send secrets to it.

## Model defaults (owner, 10-14 02:20)

Pick sensible defaults (chat: Sonnet 5.5; compaction: Haiku 5.5; spend cap: $2/day). Settings must let the owner change the chat model across the latest models of Claude Sonnet, Claude Opus, Muse, GPT Sol and Grok (resolved from the provider catalogue at runtime), plus the compaction model and the spend cap. The model can never change these.

## Owner decisions on plan v3 (10-14 02:31)

- T3 Code sessions started by Juno run with full access, each in a new worktree.
- Backup: a local folder on disk that the owner chooses (he may point it at a synced drive later). Default to a folder under the app's data directory and make the path a setting.
- Owner bubble colour: decide after a mock of coral and neutral in both themes.
- Using T3 Code over a network (non-loopback) address needs a Settings switch, off by default.
- Sign in with ChatGPT: not planned for now (Codex local and OpenRouter cover it).
