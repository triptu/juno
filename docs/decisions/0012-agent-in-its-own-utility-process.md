# 0012. Run Juno Agent in its own utility process, reaching Juno through an AgentHost port

Status: accepted, 2026-10-14. Built as a scaffold in M1 (WP1); the chat runs on it from M2.

## Context

Juno Agent (`docs/juno-agent/plan-v3.md`) is a portable assistant: it should be able to run as its own app or inside another one, with the same state. So its core cannot depend on Electron, Slack, or Juno's store, sync and engine. It also does work the engine should not share a thread with: a durable runtime that commits to SQLite at `synchronous = FULL` with `fullfsync` (about 3 ms per commit, measured in WP0), model streams, MCP connections, a local Codex process and backups. And it holds secrets the engine does not need, while the engine holds the Slack cookie, which the agent must never see.

## Decision

- The agent core is `@juno/agent`, a plain Node program started with `startAgent(config, connection)`. Electron runs it in a second `utilityProcess` (`apps/desktop/src/agent`, built to `out/main/agent.js`), forked **without** the `persist:slack` partition.
- The agent reaches Juno only through the **AgentHost port**: an `effect/rpc` group in `@juno/agent-contract` (`AgentHostRpcs`) that the host serves and the agent calls. In Juno the engine serves it (`packages/engine/src/protocol/agentHost.ts`) with handlers from `@juno/agent-juno`. Another host app would serve the same group.
- Main brokers the port. Each time the engine reports ready, main makes a `MessageChannelMain`, sends one end to the engine (`agentPort`) and the other to the agent (`hostPort`). The agent's client takes the newest port after a close, so it follows engine restarts the way the renderer does (ADR 0009).
- The first call on a port is `host.hello`. The agent refuses a host whose `AGENT_HOST_PROTOCOL` differs from its own.
- Main keeps what needs Electron: the keychain, OAuth windows (pi-mcp does not open a browser) and OS notifications. These become parentPort requests from the agent in WP13, like the engine's.
- The renderer will get its own port to the agent for the chat (WP13), so chat traffic does not pass through the engine.
- `check-deps` enforces the boundary: no agent package imports or declares Electron or a Slack package; the core also stays away from the store, sync, engine and UI packages; pi-durable, pi-mcp, pi-ai and the Codex SDK are each imported from one folder of `@juno/agent`; the agent entry imports no engine or Slack code.
- Until the chat ships (M2), main starts the agent only when `JUNO_AGENT=1`, so app startup is unchanged.

## Alternatives

- **Run the agent inside the engine process.** One process fewer, but the agent's FULL commits, Codex child process and model traffic would compete with the engine's sync and live queries on one event loop, a crash in either takes down both, and the agent would sit next to the Slack cookie.
- **Agent as a server the engine calls.** The host is the one with Slack access, so the agent is the natural client of host services. Host-to-agent signals (a message in the open topic) come back as stream routes on the same group.

## Consequences

- Two utility processes. The agent costs a process's memory once it is on by default (M2). Its startup does not block the window or the engine.
- Main relays OAuth and keychain requests for the agent, so `apps/desktop/src/main/agent.ts` grows in WP13 (restart with backoff, the renderer port, the requests).
- Tests can start the agent under Node with a Node `MessagePort`, and the engine with an `agentTransport`, without Electron. The e2e `apps/desktop/e2e/juno-agent/hello.spec.ts` covers the processes and the brokered port.
