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
| `recovery/` | Incarnations and rotation; the open sequence: journal at or ahead of the archive resumes, behind rotates, newer schema stops | `openJournal`, `rollbackJournal`, `rotate` |
| `runtime/` | The only pi-durable importer: the journal facade, the owner lock, the crash points, the core and its run loop, the Effect service | `acquire`, `collect`, `releaseLock` |

Notes for the work packages that build on it:

- **Migrations.** Add a `MigrationSet` in your own folder (for example `spend/schema.ts`) and pass it in `CoreOptions.migrations`. Steps are append-only. `LOCAL_TABLES` lists tables a backup must not capture; add yours.
- **The run loop** in `runtime/core.ts` is the simplest router: one op at a time, follow-up order, no steering. WP11's router replaces it and keeps `inbox/bridge.ts`. Never reset while a run is live: pi ends a run when a reset is placed during a tool round.
- **Compaction.** `runJob(store, key, model, h)` runs one job with a `CompactionModel` (`summarize(task)`); `readyKeys` says which keys may start. WP11's compactor schedules them (8 at once, waking at `due_at`) and calls the model through WP9's providers.
- **Actions.** `store/ledger.ts` has the parts of the ledger that startup and Pause need. WP15 builds the dispatcher on `authorize`, `recordAttempt` and `recordReceipt` and adds intents, approvals and grants in its own migration set.
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

## Providers and spend (WP9)

Pass `migrations: [SPEND_MIGRATIONS]` to `openCore` or `DurableCore.layer`, along with any other feature migration sets. The spend tables are replicated records. `PROVIDER_LOCAL_TABLES` lists the catalogue cache, daily resolutions and measured token multipliers. The public `LOCAL_TABLES` combines them with the core tables for backup exclusion.

- `createSpend(core.store)` (or `Spend.layer`) supplies the shared reservation ledger. Amounts are integer nanodollars; `dollars(n)` rounds up. `reserve(path, amount)` atomically checks the total cap and the compaction sub-budget. `settle(id, undefined)` keeps an unknown reservation, including across restarts. Known settlement and `allowDollar(clickOpId)` are idempotent. A raise is one dollar on the click's day, and never a model tool. `setCap` refuses a reduction below existing obligations; the Settings-owned cap callback supplies the default for new days. A day is the local calendar date at reservation time; settlement stays on that day.
- `createCatalogue(store, { systemAndTools })` caches OpenRouter's public catalogue. Call `refresh()` at startup and daily. The response has picker rows, `stale`, and model changes for WP11 to log in Activity. `codex(await adapter.listModels())` pins local Sol for the day. A failed listing falls back to pi's catalogue; a successful empty listing offers nothing. Save `row.choice` (`family`, `provider`), and choose its resolved model at the next run boundary. `resolveCatalogue` and `resolveCodexModels` are the pure resolver APIs.
- `createOpenRouter({ store, models, apiKey })` returns the guarded provider API. The key callback reads main's keychain bridge. Only give `guard.models` to the journal. `createProviderGuard({ store, transport })` is the same boundary with an injected transport, used with `fakeProvider` in tests. `ProviderGuard.layer` exposes it as an Effect service.
- WP11 calls `guard.stamp(admittedRequest, model, wireContext, path)` in its trusted builder hook. First persist any emergency memory merge and rebuild; the guard rechecks `rev`, `gen` and `pinRev`. The hook must construct `wireContext` from the builder result, preserving tool IDs and metadata. Omitting it gives a text-only context. The guard copies and hashes the complete normalized context and consumes its stamp once at provider dispatch. Raw context after a throwing hook, a changed context, or a reused stamp fails as interrupted. Images are refused until they have a measured bound. Stamps are in memory only, so resumed requests must rebuild.
- The guard reserves before dispatch, forces a 16,384-token output ceiling and `maxRetries: 0`, preserves `sessionId`, and uses pi's short prompt caching. The final payload hook recounts adapter framing and extends the reservation before transport if needed. It refuses any second payload dispatch, including pi's strict-tool compatibility retry. Reservations use the highest input/cache/tier rate. Lost streams and missing usage keep their reservation. An input report above the bound enables a persisted 1.25 multiplier for the provider's future requests.
- `providerFailure(error)` gives the chat `Ending` plus `rateLimited`. Rate limits are `failed.provider`, rejected keys are `failed.keyRejected`, and lost connections are `failed.offline`. Admission failures are `interrupted` or `blocked.tooLarge`; spend refusals are `blocked.budget`. The stream carries these fixed reasons without retaining provider error bodies. `onFailure` receives the same projection.
- `createCompactionProvider({ store, guard, model, system, tools, sessionId })` implements WP8's `CompactionModel` for `runJob`. Every attempt goes through the same guard and compaction sub-budget. WP11 owns scheduling, pauses, and budget cards. Tools are declared for cache consistency; a tool-call answer is refused.
- `createCodexAdapter({ agentDir, guard, executable })` supplies `status`, `listModels`, and a thin `turn`. Its home is `agentDir/codex`. Settings uses `loginEnvironment()` for an explicit sign-in; the adapter never borrows the owner's Codex credentials. Each admitted, signed-in turn uses a fresh empty temporary directory, read-only sandbox, disabled built-ins and an approved Juno MCP server. The caller supplies the per-turn loopback endpoint and bearer token. Turns are counted, not charged, and thread IDs and their home are recorded for redaction. WP20 still owns `juno.harnessTurn`, MCP server lifetime, and redaction of the session files.

Integration limits found during WP9:

- WP8 requires models before opening the core, but the guard needs the core's store. The application must provide a deferred model facade, attach the guard after `openCore`, then start requests. WP11 must address startup ordering before resuming queued journal work; WP9 does not change WP8's automatic resume loop.
- The hard-cap proof assumes reported usage does not exceed the reserved upper bound and quoted prices. If a provider violates that assumption, the ledger records its actual charge rather than hiding it; further admissions stop at the exhausted cap. The multiplier is a future-request response, not a way to undo a provider charge.
- The actions spec conservatively keeps the original compaction allocation even after known settlement. The ledger releases the unused part of a known reservation, as §5.4 specifies, while enforcing the same 25% invariant. The spec has no daily reset or raise action; the implementation tests those as well. No specs were changed in WP9.
