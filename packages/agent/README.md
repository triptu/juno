# @juno/agent

The Juno Agent core: a portable, durable personal assistant. A plain Node program that runs in its own Electron utility process (ADR 0012) and, for tests, under plain Node. Plan v3 (`docs/juno-agent/plan-v3.md`) is the design; `docs/juno-agent/spikes.md` records what the pinned libraries actually do.

## What it owns today

- `startAgent(config, connection)`: connects to the host over the AgentHost port, calls `host.hello`, checks the protocol, and returns `{ host, stop }`. `connection.acquire()` gives the next host port; the client takes a new one after the host restarts.
- `src/host/`: the `AgentHost` service (an `effect/rpc` client of `AgentHostRpcs`) and its port protocol, the same shape as the renderer's engine client.

## Where the rest goes

Each folder has one owner (plan v3 §17). Only that folder imports its library (`check-deps`):

| Folder | Work package | Library |
| --- | --- | --- |
| `src/runtime/`, `src/store/`, `src/inbox/`, `src/projection/`, `src/recovery/` | WP8 | `src/runtime/` is the only importer of `@earendil-works/pi-durable` and `@earendil-works/chord` |
| `src/providers/`, `src/spend/` | WP9, WP20 | `src/providers/` is the only importer of `@earendil-works/pi-ai` and `@openai/codex-sdk` |
| `src/request/`, `src/compactor/`, `src/router/`, `src/jobs/`, `src/memory-tools/`, `src/pins/` | WP11 | |
| `src/actions/`, `src/grants/`, `src/policy/` | WP15 | |
| `src/redaction/` | WP16 | |
| `src/mcp/` | WP17 | the only importer of `@earendil-works/pi-mcp` |
| `src/t3/`, `src/littlebird/` | WP18 | |
| `src/schedule/` | WP19 | |
| `src/ownership/`, `src/backup/` | WP21 | |

Versions are pinned exactly: pi 1.2.0 and the Codex SDK 0.162.1. Spike findings that bind the implementation: open pi's journal through `openNodeSqliteDatabase` with `synchronous = FULL`, `fullfsync = ON` and `checkpoint_fullfsync = ON`; the owner lock is an SQLite file held with `locking_mode = EXCLUSIVE`, and its connection must stay referenced.

## Must not

- Import Electron, any Slack package, `@juno/store`, `@juno/sync`, `@juno/engine` or UI packages (`check-deps` fails on the import and on the declared dependency).
- Reach Juno other than through the AgentHost port.
