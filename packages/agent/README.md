# @juno/agent

The Juno Agent core: a portable, durable personal assistant. A plain Node program that runs in its own Electron utility process (ADR 0012) and, for tests, under plain Node. Plan v3 (`docs/juno-agent/plan-v3.md`) is the design; `docs/juno-agent/spikes.md` records what the pinned libraries actually do.

## What it owns today

- `startAgent(config, connection, { turns?, renderer? })`: connects to the host over the AgentHost port, calls `host.hello`, refuses a host on another protocol, follows `host.presence`, and, given `turns`, opens the turn engine on `config.agentDir` with the Slack read tools bound to the host. Given `renderer`, it serves the renderer's RPCs on the ports that transport gives. Returns `{ host, turns, reads, presence, presenceChanges, stop }`. `connection.acquire()` gives the next host port; the client takes a new one after the host restarts.
- `openRouterTurns(apiKey)`: the app's turn options: OpenRouter, with the default chat and compaction families resolved in pi-ai's catalogue (`piFamilyModel`, no network). The key is read on each request.
- `src/serve/`: the renderer's RPCs (`AgentRpcs`). See "The chat server" below.
- The turn engine (WP11): `openTurns(options)`, or the `TurnEngine` Effect service. See "Turns" below.
- `src/host/`: the `AgentHost` service (an `effect/rpc` client of `AgentHostRpcs`, protocol 2) and its port protocol, the same shape as the renderer's engine client. `reads.ts` binds the read tools' `HostReads` to the account the latest `host.presence` names: a read after an account switch fails with `stale` at the host, and with none signed in it fails with `signedOut`.
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
| `store/` | `schema.ts`: the tables, as named migration sets. `database.ts`: open, pragmas, migrate. `ledger.ts`: Pause, AI off, authorization, attempt, receipt, startup classification. `memory.ts`: memory queue, jobs, publication and the compaction seam | `startup`, `pause`, `cancel`, `authorize`; memory `project`, `start`, `complete`, `publish`, `extend`, `merge`, `failJob` |
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

## Providers and spend (WP9)

Pass `migrations: [SPEND_MIGRATIONS]` to `openCore` or `DurableCore.layer`, along with any other feature migration sets. The spend tables are replicated records. `PROVIDER_LOCAL_TABLES` lists the catalogue cache, daily resolutions and measured token multipliers. The public `LOCAL_TABLES` combines them with the core tables for backup exclusion.

- `createSpend(core.store)` (or `Spend.layer`) supplies the shared reservation ledger. Amounts are integer nanodollars; `dollars(n)` rounds up. `reserve(path, amount)` atomically checks the total cap and the compaction sub-budget. `settle(id, undefined)` keeps an unknown reservation for good, including across restarts: a late report does not change it (spec `settleSpend`). Only the first settlement counts, and `allowDollar(clickOpId)` is idempotent. A raise is one dollar on the click's day, and never a model tool. `setCap` refuses a reduction below existing obligations; the Settings-owned cap callback supplies the default for new days. A day is the local calendar date at reservation time; settlement stays on that day.
- `createCatalogue(store, { systemAndTools })` caches OpenRouter's public catalogue. Call `refresh()` at startup and daily. The response has picker rows, `stale`, and model changes for WP11 to log in Activity. Each row has `price` in dollars per million tokens (none for Codex) for the view's price hint. `codex(await adapter.listModels())` pins local Sol for the day. A failed listing falls back to pi's catalogue; a successful empty listing offers nothing. Save `row.choice` (`family`, `provider`), and choose its resolved model at the next run boundary. `resolveCatalogue` and `resolveCodexModels` are the pure resolver APIs.
- `createOpenRouter({ store, models, apiKey })` returns the guarded provider API. The key callback reads main's keychain bridge. Only give `guard.models` to the journal. `createProviderGuard({ store, transport })` is the same boundary with an injected transport, used with `fakeProvider` in tests. `ProviderGuard.layer` exposes it as an Effect service.
- WP11 calls `guard.stamp(admittedRequest, model, wireContext, path)` in its trusted builder hook. An admitted `Request` is a `Revision`; a `Blocked` one does not type-check, because it makes no provider call. First persist any emergency memory merge. The guard rechecks `gen` and `pinRev` at dispatch, as the memory spec's `dispatchWith` does: a redaction or pin change after the build refuses the request, and a newer view (`rev`) does not. The hook must construct `wireContext` from the builder result, preserving tool IDs and metadata. The guard copies and hashes the complete normalized context and consumes its stamp once at provider dispatch. Raw context after a throwing hook, a changed context, or a reused stamp fails as interrupted. Images are refused until they have a measured bound. Stamps are in memory only, so resumed requests must rebuild.
- The guard reserves before dispatch, forces a 16,384-token output ceiling and `maxRetries: 0`, preserves `sessionId`, and uses pi's short prompt caching. The final payload hook recounts adapter framing and extends the reservation before transport if needed. It refuses any second payload dispatch, including pi's strict-tool compatibility retry. Reservations use the highest input/cache/tier rate. Lost streams, server errors and missing usage keep their reservation. A rejected key or a rate limit before any output releases it, because the provider did no work. An input report above the bound enables a persisted 1.25 multiplier for the provider's future requests.
- `providerFailure(error)` gives the chat `Ending` plus `rateLimited`. Rate limits are `failed.provider`, rejected keys are `failed.keyRejected`, and lost connections are `failed.offline`. Admission failures are `interrupted` or `blocked.tooLarge`; spend refusals are `blocked.budget`. The stream carries these fixed reasons without retaining provider error bodies. `onFailure` receives the same projection.
- `createCompactionProvider({ store, guard, model, system, tools, sessionId })` implements WP8's `CompactionModel` for `runJob`. Every attempt goes through the same guard and compaction sub-budget. WP11 owns scheduling, pauses, and budget cards. Tools are declared for cache consistency; a tool-call answer is refused.
- `createCodexAdapter({ agentDir, guard, executable })` supplies `status`, `listModels`, and a thin `turn`. Its home is `agentDir/codex`. Settings uses `loginEnvironment()` for an explicit sign-in; the adapter never borrows the owner's Codex credentials. `turn({ revision, prompt, model, mcp })` admits the prompt through `guard.admitHarness` first. Each admitted, signed-in turn uses a fresh empty temporary directory, read-only sandbox, disabled built-ins and an approved Juno MCP server. The caller supplies the per-turn loopback endpoint and bearer token. Turns are counted, not charged, and thread IDs and their home are recorded for redaction. WP20 still owns `juno.harnessTurn`, MCP server lifetime, and redaction of the session files.

Integration limits found during WP9:

- WP8 requires models before opening the core, but the guard needs the core's store. The application must provide a deferred model facade, attach the guard after `openCore`, then start requests. WP11 must address startup ordering before resuming queued journal work; WP9 does not change WP8's automatic resume loop.
- The hard cap holds while reported usage stays within the reserved upper bound and quoted prices. A provider that reports more is recorded as it reports: the ledger never records less than was charged, so one request can take the day over its cap. Once the day (or compaction's share) is at or over its limit, every new reservation is refused, whatever its amount, until midnight or a raise (decision log, 10-14 09:49; spec `overReportStep`). The 1.25 multiplier then applies to the provider's later requests; it does not undo the charge.
- The actions spec conservatively keeps the original compaction allocation even after known settlement. The ledger releases the unused part of a known reservation, as §5.4 specifies, while enforcing the same 25% invariant. The spec has no daily reset or raise action; the implementation tests those as well. The spec also settles every reservation either as known or as lost; releasing a reservation the provider refused (key, rate limit) is a known settlement of zero. No specs were changed in WP9.

## Turns (WP11)

`openTurns({ agentDir, provider, model, compaction?, subagent?, host? })` opens the engine: the durable core's open sequence with the router in place of WP8's serial loop. `provider(store)` builds the guarded provider (`createOpenRouter`, or `createProviderGuard` in tests) on the opened store.

**Startup order.** Lock, `agent.sqlite` and migrations (spend, turns, jobs and the caller's), recovery (open authorizations become `unknown`), then `provider(store)`, then pi on the journal with only the guard's models, then the router restores the live run, and only then does pi resume. So pi never reaches a model before the guard exists, and a resumed request is built and stamped like any other; no deferred model facade is needed. `router/open.ts` copies `openCore`'s open sequence because the router needs the journal and its hooks for steering and the core does not expose them. Letting `openCore` take a router would remove the copy.

| Folder | Does |
| --- | --- |
| `router/` | The router (one owner input, one run), the engine (`open.ts`), turn events, the Slack read tools over the host port, the `runs` tables |
| `request/` | The request builder in pi's `beforeRequest`: one snapshot, `buildRequest`, then `guard.stamp`. The tool shape and Juno's system text |
| `compactor/` | Background memory jobs on `runJob` and WP9's compaction provider: at most 8 at once, never past a live run's cutoff, paused while Juno is paused or compaction's share of the cap is used |
| `jobs/` | Background jobs behind Task cards (subagents now, T3 in WP18), the `delegate` tool, milestone reports into the inbox |
| `memory-tools/` | `remember` |
| `pins/` | Pin changes on the trusted side, each bumping `pin_rev` in its transaction |

**The chat's surface** is two calls: `accept` queues an input (a message, maybe a reply; a reaction; a report, wake or click), and `subscribe` listens to events. Nothing stops a run from outside: to change course the owner sends another message, and "stop" is a message like any other. Only recovery, the guard and shutdown end a run early. How Juno talks (how many bubbles, how long, whether to answer a reaction) is the model's judgement, guided by the short prompt in `request/prompt.ts`; the code keeps hard rules only for safety and cost.

**What the owner sees** (`router/output.ts`). The chat is not a transcript. Only text the model marks becomes visible:

```text
<say>One bubble.</say>
<say reply-to="n12">A bubble that answers owner message n12.</say>
<react to="n12">👍</react>
```

The router parses the stream and publishes each block once it closes: a bubble appears whole (`bubble` event, id `<runId>:<n>`), never streamed. Text outside the blocks never leaves the agent; if the model marks nothing, nothing shows. Why blocks and not a `say` tool: pi answers every tool call with a tool result and calls the model again, so a tool per bubble costs one more request per turn. The archive keeps the raw text, so parsing it gives the same bubbles (`input.ts` `archivedBubble`), and a restored run carries on numbering where it was.

**What the model reads** (`router/input.ts`). Owner input is wrapped with a handle the model can reply or react to: `<message id="n12">…</message>`, where `n12` is the inbox `seq`. A reply carries the quoted bubble, card or message in full (`<quote from="juno">…</quote>`). A reaction is `<reaction id="n13" emoji="🎉"><quote …>…</quote></reaction>`. Nothing is escaped, so the owner's words stay byte for byte and a pin points only at them (`ownerWords`), never at a quote or a reaction.

**Reactions** (`reactions` table). Any one emoji, both ways, at most one per side per item; a null emoji removes it. The owner's thumbs up and removals are only recorded: no run, and the model never sees them. Any other owner reaction is also an inbox op (`react`): it joins a live run at its next step or starts one, and the model may ignore it, in which case the owner sees nothing. Juno's reactions come from `<react>` blocks on owner messages. A reaction is never a click and never a pin.

**A run.** The router commits the run (its history cutoff `H` and origin) before the input reaches pi, then resets and submits through `inbox/bridge.ts`. Every request goes through the builder and the guard. Input that arrives while a run is live is held in the inbox and handed to pi as a steer at the next boundary (pi's `afterTools` or `onYield`); pi places it right there, and with `steeringMode: 'all'` every message held at that boundary joins together. It is held until the boundary, not queued in pi at once, because pi keeps a queued steer after a failed run until the next input; held input that no boundary took starts the next run. The run ends with the chat contract's `Ending`: the builder's or guard's refusal (`blocked`, `interrupted`); a provider failure (`failed`, or `interrupted` when the stream had started and was lost); `complete` when pi answered every input. Owner runs carry `retry` on `interrupted` and `failed`. A steered report or wake, or a Slack read, marks the run as no longer clean (§6.4).

**Events** (`subscribe`): `started` (the status bubble, dots), `bubble` (one whole bubble; the dots go back below it while the run goes on), `status` (a tool's line, until the next bubble), `reaction` (either side, set or removed), `steered` (a held message was handed to pi), `remembered`, `ended`. `run()` gives the live run (its bubbles and status) for a renderer that attaches mid-run.

**Tools.** Each is a `defineTool` with a status line and a `replay` mode. A tool calls `current()` inside `execute()` to get the live run: its cutoff, whether it is clean, and the journal position read after pi committed the call's intent. A tool that authorizes an action (WP15) passes that `position` to `authorize` and keeps `replay: 'unsafe'`. No WP11 tool authorizes: `remember` writes a pin keyed by the call id, `delegate` starts a job keyed by the call id, and the Slack reads are Tier 0.

**`remember`** takes exact words the owner wrote in this run. The trusted side finds them among the run's owner messages (`[H, cutoff)`) and copies the bytes; the model never names a message id or offsets. "Remember this" (`pins.pinMessage`), edits and Undo name the pin version they replace.

**Testing.** `test/turns.test.ts` runs the engine in-process with `fakeProvider`; `test/turns-crash.test.ts` kills it mid-turn under the crash harness.

## The chat server (WP13b)

`src/serve/` serves `AgentRpcs` to the renderer on the ports main brokers (ADR 0012). `rendererServer(transport, { turns, presence, presenceChanges })` is the layer; `startAgent` builds it when given a `renderer` transport.

- **The page** (`chat.ts`) is built from the agent's records on every change: owner messages from the inbox (`send` and `steer`; a `retry` is the same message again, so it is not a second bubble), each run's bubbles parsed from its archived text (the live run's from the router), endings from `runs`, the latest reaction per side and item, day separators, the "New" divider and group positions (same sender, within two minutes, same origin). A finished bubble is timed by the archive row it was written in; a live bubble by when the server first saw it, so the order does not move when the archive catches up. A window is cut from the whole list; anchors are any row's own id.
- **Read state** is one mark in `chat_read` (`CHAT_MIGRATIONS`, a replicated table): Juno's bubbles at or before it are read. `agent.chat.read` takes a bubble or an archive message and only moves the mark forward.
- **The banner**: `updateNeeded`, then `aiOff` (AI assist off in Juno, or the mode is off), `paused`, `offline` (the host is not live), else `none`. The composer is off for `updateNeeded` and `aiOff`.
- **Commands**: send, react and retry go to the engine's inbox and answer after the commit; `tooLong` and a failed write (`notDelivered`) come back as errors. With AI assist off they answer `unavailable`.
- **Not served yet**: cards (WP15), Remove (WP16), the Scheduled, Remembers, Memory, Activity, Connections and Review pages, and Settings › Juno. Their commands answer `unavailable` and their streams end with a defect.
- **Not listed yet**: cards and notes ("Remembered"), and schedule origins (a wake shows as Juno's own run). A message's `context` (the topic or the person it was sent about) is stored with the op but not yet shown to the model; that is the request builder's (WP11).
- **Cost**: each change rebuilds the whole list with a few queries, and parses finished runs' text again. That is fine for M2; a 5,000-message chat will want finished runs cached, against the budget in `docs/performance.md`.

`test/serve.test.ts` runs the server on the real engine with the scripted model, through an RPC client on a Node `MessageChannel`. `packages/state/test/agent-chat.test.ts` runs the renderer's atoms against it.
