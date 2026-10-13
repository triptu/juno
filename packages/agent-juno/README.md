# @juno/agent-juno

Juno as the agent's host. It runs inside the engine and implements the AgentHost group from `@juno/agent-contract`: today `host.hello`; from WP13 the Slack read tools, sends and resolve through the outbox in single-attempt mode, the "this" topic, presence and the notification gate.

`AgentHostHandlers` is the handler layer. The engine serves it on the ports main brokers from the agent process (`packages/engine/src/protocol/agentHost.ts`, ADR 0012).

## Must not

- Call a model. The agent decides; the host only reads and writes Juno's data.
- Import Electron or any Slack package directly. Slack access goes through the engine's services (WP13 wires them in `packages/engine/src/agent-host/`).
