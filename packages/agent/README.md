# @juno/agent

The Juno Agent core: a portable, durable personal assistant. A plain Node program that runs in its own Electron utility process (ADR 0012) and, for tests, under plain Node. Plan v3 (`docs/juno-agent/plan-v3.md`) is the design; `docs/juno-agent/spikes.md` records what the pinned libraries actually do.

## What it owns today

- `startAgent(config, connection)`: connects to the host over the AgentHost port, calls `host.hello`, checks the protocol, and returns `{ host, stop }`. `connection.acquire()` gives the next host port; the client takes a new one after the host restarts.
- `src/host/`: the `AgentHost` service (an `effect/rpc` client of `AgentHostRpcs`) and its port protocol, the same shape as the renderer's engine client.
- The durable core (WP8): `openCore(options)`, or the `DurableCore` Effect service with `DurableCore.layer(options)`. `options` names the agent directory and gives pi-ai's `models` and the chat model (WP9 supplies them), plus WP11's pi extensions. It returns the running core, or `updateNeeded` ("Juno needs to update its records") when a newer Juno wrote `agent.sqlite` or the journal.

## The durable core

Files in the agent directory (plan v3 §2.2):

| File | What |
| --- | --- |
| `owner.lock` | The single-writer lock: an SQLite file held with `locking_mode = EXCLUSIVE`. Its connection is referenced from module scope and closed last (G9). A second process fails with `OwnerLockHeld` |
| `agent.sqlite` | Juno's own records, WAL with `synchronous = FULL`, `fullfsync` and `checkpoint_fullfsync` |
| `pi-<incarnation>.sqlite` | The pi-durable journal, opened through pi's Node adapter with the same settings |

What each folder does, and the spec transitions it implements (`specs/agent-recovery.qnt`, `specs/agent-memory.qnt`):

| Folder | Does | Spec |
| --- | --- | --- |
| `store/` | `schema.ts`: the tables, as named migration sets. `database.ts`: open, pragmas, migrate. `ledger.ts`: Pause, AI off, Stop, authorization, attempt, receipt, startup classification. `memory.ts`: memory queue, jobs, publication and the compaction seam | `startup`, `pause`, `cancel`, `authorize`; memory `project`, `start`, `complete`, `publish`, `extend`, `merge`, `failJob` |
| `inbox/` | `inbox.ts`: owner input, durable before it is acknowledged. `bridge.ts`: reset, submit with `requestId = op_id`, then `submitted` | `acceptInput`, `acknowledge`, `resetBridge`, `submit`, `markSubmitted` |
| `projection/` | One transaction per pi commit: archive messages (chunks of at most 16 KB), their memory keys, the cursor | `project` |
| `recovery/` | Incarnations and rotation; the open sequence: a journal at or ahead of both the archive cursor and the latest authorized position resumes, behind either rotates, newer schema stops | `openJournal`, `rollbackJournal`, `rotate`; `agent-recovery-replay.qnt` |
| `runtime/` | The only pi-durable importer: the journal facade, the owner lock, the crash points, the core and its run loop, the Effect service | `acquire`, `collect`, `releaseLock` |

Notes for the work packages that build on it:

- **Migrations.** Add a `MigrationSet` in your own folder (for example `spend/schema.ts`) and pass it in `CoreOptions.migrations`. Steps are append-only. `LOCAL_TABLES` lists tables a backup must not capture; add yours.
- **The run loop** in `runtime/core.ts` is the simplest router: one op at a time, follow-up order, no steering. WP11's router replaces it and keeps `inbox/bridge.ts`. Never reset while a run is live: pi ends a run when a reset is placed during a tool round.
- **Compaction.** `runJob(store, key, model, h)` runs one job with a `CompactionModel` (`summarize(task)`); `readyKeys` says which keys may start. WP11's compactor schedules them (8 at once, waking at `due_at`) and calls the model through WP9's providers.
- **Actions.** `store/ledger.ts` has the parts of the ledger that startup and Pause need. WP15 builds the dispatcher on `authorize`, `recordAttempt` and `recordReceipt` and adds intents, approvals and grants in its own migration set.
- **Authorizations and replay.** `authorize` takes `position`: read it with `Core.position()` inside the tool's `execute()`, after pi has committed the call's execute intent. It raises the incarnation's `authorized_seq`, and recovery never resumes a journal behind it. So an older copy of the journal that lost the intent rotates instead of running the call, and its effect, again. A tool with an effect keeps pi's default `replay: "unsafe"`; pi then settles a call interrupted after its intent as interrupted, and never runs it twice.
- **pi internals read.** `durable_metadata.next_seq`, `durable_schema.version` and `entries.commit_seq` are pi-internal. Juno adds its own `juno_incarnation` table and an index on `entries (conversation_id, commit_seq)` to the journal file. The crash tests fail if pi renames them.

## Crash points

`src/runtime/crash.ts` names the crash points (plan v3 §16). `@juno/agent-testing` re-exports them for its harness. The agent calls `crashPoint(name)` right after each commit; with `JUNO_AGENT_CRASH_AT` set to that name it kills itself with SIGKILL.

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

Versions are pinned exactly: pi 1.2.0 and the Codex SDK 0.162.1.

## Testing

`pnpm test:agent` from the root, behind the machine-wide lock. `test/recovery.test.ts` runs the core as a process (`test/fixtures/program.ts`) under the crash harness: it kills it at each named point or restores files from an earlier commit boundary, restarts it and checks the spec's post-condition. `bench/commit-cost.ts` measures the cost of a commit.

## Must not

- Import Electron, any Slack package, `@juno/store`, `@juno/sync`, `@juno/engine` or UI packages (`check-deps` fails on the import and on the declared dependency).
- Reach Juno other than through the AgentHost port.
