# @juno/agent-juno

Juno as the agent's host. It runs inside the engine and implements the AgentHost group from `@juno/agent-contract`: today `host.hello`; from WP13 the Slack read tools, sends and resolve through the outbox in single-attempt mode, the "this" topic, presence and the notification gate.

`AgentHostHandlers` is the handler layer. The engine serves it on the ports main brokers from the agent process (`packages/engine/src/protocol/agentHost.ts`, ADR 0012).

## Must not

- Call a model. The agent decides; the host only reads and writes Juno's data.
- Import Electron or any Slack package directly. Slack access goes through the engine's services (WP13 wires them in `packages/engine/src/agent-host/`).

## WP13 contract handoff

WP6 defines `AgentHostFullRpcs` and `AGENT_HOST_FULL_PROTOCOL` (2) in `agent-contract/src/host/services.ts`. The running scaffold still serves `AgentHostRpcs` (hello only, protocol 1). WP13 must switch the server, client and hello version together when the new handlers are ready.

Implement the four groups through engine services: `HostReadRpcs` (Slack and topic reads), `HostActionRpcs` (single-attempt sends, resolve, cancellation and reconciliation), `HostPresenceRpcs` (including the current topic), and `HostNotificationRpcs` (OS delivery only).

Persist the consumed authorization and attempt before transport. The same authorization must never submit twice, including after an RPC disconnect. Do not use the outbox's normal retry policy for these sends. A missing history match stays unknown; only positive evidence settles a send. Keep receipt evidence when cancellation arrives late. Notification ids deduplicate OS delivery, and quiet hours hold notifications independently of chat or action admission.
