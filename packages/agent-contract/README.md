# @juno/agent-contract

Juno Agent's wire. Schemas only, no logic.

| Folder | Owner | Holds |
| --- | --- | --- |
| `src/host/` | WP6 (Astra), seeded by WP1 | The AgentHost port: what the host app serves the agent (`AgentHostRpcs`, today only `host.hello`), and the parentPort messages between main and the agent process (`MainToAgent`, `AgentToMain`) |
| `src/rpc/` | WP6 (Astra) | The RPC groups the agent serves to the renderer |
| `src/chat/` | WP7 (Fable) | Chat items, chat states, card view models and page view models |

The agent is the client of `AgentHostRpcs` and the host serves it, over a port main brokers between the two utility processes (ADR 0012). `AGENT_HOST_PROTOCOL` goes up when a change breaks an older agent or host; the agent checks it on `host.hello`.

`effect/rpc` may be imported here (`scripts/check-deps.mjs`, the effect skill).

## Must not

- Hold logic. Import Electron or any Slack package.
