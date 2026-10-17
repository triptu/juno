# @juno/agent

The Juno Agent core: a portable, durable personal assistant. A plain Node program that runs in its own Electron utility process (ADR 0012) and, for tests, under plain Node. Plan v3 (`docs/juno-agent/plan-v3.md`) is the design; `docs/juno-agent/spikes.md` records what the pinned libraries actually do.

## What it owns today

- `startAgent(config, connection, { turns?, renderer? })`: connects to the host over the AgentHost port, calls `host.hello`, refuses a host on another protocol, follows `host.presence`, and, given `turns`, opens the turn engine on `config.agentDir` with the Slack read tools bound to the host. Given `renderer`, it serves the renderer's RPCs on the ports that transport gives. Returns `{ host, turns, reads, presence, presenceChanges, stop }`. `connection.acquire()` gives the next host port; the client takes a new one after the host restarts.
- `providerTurns(connection, picker?)`: the app's turn options: the active provider, OpenRouter or one OpenAI-compatible endpoint (`createProviderTransport`, both behind one guard), with the owner's saved choice (`src/settings/`) in the picker's rows, and the saved daily cap. `providerConnection()` holds the provider main sends, keys included, in memory; a request waits until main has sent one. `modelPicker(connection, { origin? })` lists the active provider's rows: OpenRouter's catalogue once read today (`createCatalogue`), else pi-ai's own (`piRows`); or the endpoint's `/models` (`listCustomModels`), else a typed id (`customRow`). Given a picker and a connection, `startAgent` also serves Settings › Juno.
- `src/settings/`: Settings › Juno (`createJunoSettings`). See "Settings › Juno" below.
- `src/serve/`: the renderer's RPCs (`AgentRpcs`). See "The chat server" below.
- The turn engine (WP11): `openTurns(options)`, or the `TurnEngine` Effect service. See "Turns" below.
- `src/host/`: the `AgentHost` service (an `effect/rpc` client of `AgentHostRpcs`, protocol 2) and its port protocol, the same shape as the renderer's engine client. `reads.ts` binds the read tools' `HostReads` to the account the latest `host.presence` names: a read after an account switch fails with `stale` at the host, and with none signed in it fails with `signedOut`.
- The durable core (WP8): `openCore(options)`, or the `DurableCore` Effect service with `DurableCore.layer(options)`. `options` names the agent directory and gives pi-ai's `models` and the chat model (WP9 supplies them), plus WP11's pi extensions. It returns the running core, or `updateNeeded` ("Juno needs to update its records") when a newer Juno wrote `agent.sqlite` or the journal.

## The durable core

Files in the agent directory (plan v3 §2.2):

| File | What |
| --- | --- |
| `owner.lock` | The single-writer lock: an SQLite file held with `locking_mode = EXCLUSIVE`. Its connection is referenced from module scope and closed last (G9). A second process fails with `OwnerLockHeld` |
| `agent.sqlite` | Juno's own records, WAL with `synchronous = FULL`, `fullfsync` and `checkpoint_fullfsync`, and `secure_delete = ON` (WP16) |
| `pi-<incarnation>.sqlite` | The pi-durable journal, opened through pi's Node adapter with the same settings |

What each folder does, and the spec transitions it implements (`specs/agent-recovery.qnt`, `specs/agent-memory.qnt`):

| Folder | Does | Spec |
| --- | --- | --- |
| `store/` | `schema.ts`: the tables, as named migration sets. `database.ts`: open, pragmas, migrate. `ledger.ts`: Pause, AI off, authorization, attempt, receipt, startup classification. `memory.ts`: memory queue, jobs, publication and the compaction seam | `startup`, `pause`, `cancel`, `authorize`; memory `project`, `start`, `complete`, `publish`, `extend`, `merge`, `failJob`, and `redact` and `purge` for `redaction/` |
| `inbox/` | `inbox.ts`: owner input, durable before it is acknowledged. `bridge.ts`: reset, submit with `requestId = op_id`, then `submitted` | `acceptInput`, `acknowledge`, `resetBridge`, `submit`, `markSubmitted` |
| `projection/` | One transaction per pi commit: archive messages (chunks of at most 16 KB), their memory keys, the cursor | `project` |
| `recovery/` | Incarnations and rotation; the open sequence: a journal at or ahead of both the archive cursor and the latest authorized position resumes, behind either rotates, newer schema stops | `openJournal`, `rollbackJournal`, `rotate`; `agent-recovery-replay.qnt` |
| `runtime/` | The only pi-durable importer: the journal facade, the owner lock, the crash points, the core and its run loop, the Effect service | `acquire`, `collect`, `releaseLock` |

Notes for the work packages that build on it:

- **Migrations.** Add a `MigrationSet` in your own folder (for example `spend/schema.ts`) and pass it in `CoreOptions.migrations`. Steps are append-only. `LOCAL_TABLES` lists tables a backup must not capture; add yours to the list in `backup/schema.ts`. Every other table must have a primary key: the session extension captures nothing from a table without one, and backup refuses to start.
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
| `src/actions/`, `src/grants/`, `src/policy/` | WP15 (built; see "Actions") | |
| `src/redaction/` | WP16 (built; see "Redaction") | |
| `src/mcp/` | WP17 | the only importer of `@earendil-works/pi-mcp` |
| `src/review/` | Auto-review (10-16) | |
| `src/t3/`, `src/littlebird/` | WP18 | |
| `src/schedule/` | WP19 | |
| `src/ownership/`, `src/backup/` | WP21 (built; see "Ownership and backup") | |

Versions are pinned exactly: pi 1.2.0 and the Codex SDK 0.162.1.

## Testing

`pnpm test:agent` from the root, behind the machine-wide lock. `test/recovery.test.ts` runs the core as a process (`test/fixtures/program.ts`) under the crash harness: it kills it at each named point or restores files from an earlier commit boundary, restarts it and checks the spec's post-condition. `bench/commit-cost.ts` measures the cost of a commit.

**Evals** (WP23) are in `eval/`: behaviour cases on the real turn engine, graded by code checks and a model judge. `eval/eval.test.ts` runs them on the scripted model in `pnpm test`; `pnpm agent:eval --live` runs them on OpenRouter. See `eval/README.md`.

## Must not

- Import Electron, any Slack package, `@juno/store`, `@juno/sync`, `@juno/engine` or UI packages (`check-deps` fails on the import and on the declared dependency).
- Reach Juno other than through the AgentHost port.

## Providers and spend (WP9)

Pass `migrations: [SPEND_MIGRATIONS]` to `openCore` or `DurableCore.layer`, along with any other feature migration sets. The spend tables are replicated records. `PROVIDER_LOCAL_TABLES` lists the catalogue cache, daily resolutions and measured token multipliers. The public `LOCAL_TABLES` combines them with the core tables for backup exclusion.

- `createSpend(core.store)` (or `Spend.layer`) supplies the shared reservation ledger. Amounts are integer nanodollars; `dollars(n)` rounds up. `reserve(path, amount, as?, background?)` atomically checks the total cap and the sub-budgets: compaction a quarter of the day's limit, `engine` half, and an engine ask marked `background` (the engine's backlog) only while the engine holds less than three eighths (spec `engineBackground`). `as` makes a reservation idempotent by id: the engine's model calls reserve and settle by their own ids through `host.spend.asks` (`start.ts` answers them), so an ask the host offers again is applied once (spec `engineBudget`). `settle(id, undefined)` keeps an unknown reservation for good, including across restarts: a late report does not change it (spec `settleSpend`). Only the first settlement counts, and `allowDollar(clickOpId)` is idempotent. `onRoom(listener)` hears when the ledger may have room again (a higher cap, a raise, or a release after a refusal), across every ledger on the same store; `answerEngineSpend` tells the host with `host.spend.room`, so the engine's jobs stopped at the cap try again at once. A raise is one dollar on the click's day, and never a model tool. `setCap` accepts a reduction below existing obligations and blocks new reservations without cancelling existing ones; the Settings-owned cap callback supplies the default for new days. A day is the local calendar date at reservation time; settlement stays on that day.
- `createCatalogue(store, { systemAndTools })` caches OpenRouter's public catalogue. Call `refresh()` at startup and daily. The response has picker rows, `stale`, and model changes for WP11 to log in Activity. Each row has `price` in dollars per million tokens (none for Codex) for the view's price hint. `codex(await adapter.listModels())` pins local Sol for the day. A failed listing falls back to pi's catalogue; a successful empty listing offers nothing. Save `row.choice` (`family`, `provider`), and choose its resolved model at the next run boundary. `resolveCatalogue` and `resolveCodexModels` are the pure resolver APIs.
- `createOpenRouter({ store, models, apiKey })` returns the guarded provider API. The key callback reads main's keychain bridge. Only give `guard.models` to the journal. `createProviderGuard({ store, transport })` is the same boundary with an injected transport, used with `fakeProvider` in tests. `ProviderGuard.layer` exposes it as an Effect service.
- WP11 calls `guard.stamp(admittedRequest, model, wireContext, path)` in its trusted builder hook. An admitted `Request` is a `Revision`; a `Blocked` one does not type-check, because it makes no provider call. First persist any emergency memory merge. The guard rechecks `gen` and `pinRev` at dispatch, as the memory spec's `dispatchWith` does: a redaction or pin change after the build refuses the request, and a newer view (`rev`) does not. The hook must construct `wireContext` from the builder result, preserving tool IDs and metadata. The guard copies and hashes the complete normalized context and consumes its stamp once at provider dispatch. Raw context after a throwing hook, a changed context, or a reused stamp fails as interrupted. An image counts by its pixel size, read from its header (`imageTokenBound` in `@juno/agent-contract`: the most Anthropic or OpenAI charge for it), never as base64 text; one whose size the header does not give, or past the limits Juno scales to, is `blocked.tooLarge`. Stamps are in memory only, so resumed requests must rebuild.
- The guard reserves before dispatch, forces a 16,384-token output ceiling and `maxRetries: 0`, preserves `sessionId`, and uses pi's short prompt caching. The final payload hook recounts adapter framing and extends the reservation before transport if needed. It refuses any second payload dispatch, including pi's strict-tool compatibility retry. Reservations use the highest input/cache/tier rate. Lost streams, server errors and missing usage keep their reservation. A rejected key, a rate limit or any other 4xx status before any output releases it, because the provider did no work. Errors are sorted with `@juno/ai-failure`, the leaf the engine's provider uses too: a refusal under the model's policy (or a moderation 403) ends the run as `failed: refused`, and the log row carries the kind (`policy`, `credits`, `unavailable`…) with only the HTTP status as its message. With `fallback` set (`providerTurns` passes the Settings › Juno choice), a request refused under the model's policy, or whose model is not found or unavailable, before any output goes once to the fallback model when it comes from another maker: its own reservation, its events continue the same stream, and the log gets two rows, the failure with kind `<kind>.fallback` and the fallback's answer. An input report above the bound enables a persisted 1.25 multiplier for the provider's future requests.
- `providerFailure(error)` gives the chat `Ending` plus `rateLimited`. Missing keys are `failed.missingKey`, rate limits are `failed.rateLimited`, rejected keys are `failed.keyRejected`, and lost connections are `failed.offline`. Admission failures are `interrupted` or `blocked.tooLarge`; spend refusals are `blocked.budget`. The stream carries these fixed reasons without retaining provider error bodies. `onFailure` receives the same projection.
- `createCompactionProvider({ store, guard, model, system, tools, sessionId })` implements WP8's `CompactionModel` for `runJob`. Every attempt goes through the same guard and compaction sub-budget. WP11 owns scheduling, pauses, and budget cards. Tools are declared for cache consistency; a tool-call answer is refused.
- `createCodexAdapter({ agentDir, guard, executable })` supplies `status`, `listModels`, and a thin `turn`. Its home is `agentDir/codex`. Settings uses `loginEnvironment()` for an explicit sign-in; the adapter never borrows the owner's Codex credentials. `turn({ revision, prompt, model, mcp })` admits the prompt through `guard.admitHarness` first. Each admitted, signed-in turn uses a fresh empty temporary directory, read-only sandbox, disabled built-ins and an approved Juno MCP server. The caller supplies the per-turn loopback endpoint and bearer token. Turns are counted, not charged, and thread IDs and their home are recorded for redaction. WP20 supplies the unsafe `juno_harnessTurn` pi tool task, its per-turn MCP server, bounded thread reuse and removal. See `src/providers/codex/README.md`.

Integration limits found during WP9:

- The default `openCore` serial loop requires models at open. `openTurns` uses the core's router hook to build the guard on the recovered store before starting pi; it needs no deferred model facade.
- The hard cap holds while reported usage stays within the reserved upper bound and quoted prices. A provider that reports more is recorded as it reports: the ledger never records less than was charged, so one request can take the day over its cap. Once the day (or compaction's share) is at or over its limit, every new reservation is refused, whatever its amount, until midnight or a raise (decision log, 10-14 09:49; spec `overReportStep`). The 1.25 multiplier then applies to the provider's later requests; it does not undo the charge.
- The actions spec conservatively keeps the original compaction allocation even after known settlement. The ledger releases the unused part of a known reservation, as §5.4 specifies, while enforcing the same 25% invariant. The spec has no daily reset or raise action; the implementation tests those as well. The spec also settles every reservation either as known or as lost; releasing a reservation the provider refused (key, rate limit) is a known settlement of zero. No specs were changed in WP9.

## Turns (WP11)

`openTurns({ agentDir, provider, model, compaction?, subagent?, host? })` opens the engine: the durable core's open sequence with the router in place of WP8's serial loop. `provider(store)` builds the guarded provider (`createOpenRouter`, or `createProviderGuard` in tests) on the opened store.

**Startup order.** Lock, `agent.sqlite` and migrations (spend, turns, jobs and the caller's), recovery (open authorizations become `unknown`), then `provider(store)`, then pi on the journal with only the guard's models, then the router restores the live run, and only then does pi resume. So pi never reaches a model before the guard exists, and a resumed request is built and stamped like any other; no deferred model facade is needed. `openCore` owns that open sequence. Its router hook receives the recovered journal file and the database release callback; `router/open.ts` builds the turn services and attaches the journal before resuming it. Restore and backup hooks run under the owner lock, before recovery.

| Folder | Does |
| --- | --- |
| `router/` | The router (one owner input, one run), the engine (`open.ts`), turn events, the Slack read tools over the host port, sources (`sources.ts`), the `runs` tables |
| `request/` | The request builder in pi's `beforeRequest`: one snapshot, `buildRequest`, then `guard.stamp`. The tool shape and Juno's system text |
| `compactor/` | Background memory jobs on `runJob` and WP9's compaction provider: at most 8 at once, never past a live run's cutoff, paused while Juno is paused or compaction's share of the cap is used |
| `jobs/` | Background jobs behind Task cards (subagents now, T3 in WP18), the `delegate` tool, milestone reports into the inbox; each T3 question has its own report, even during an existing wait. Failed Task Stop attempts stay visible on the card while the session is watched |
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

**Files** (`router/files.ts`, SPEC 13.1). A send may carry images and text files (`files` on `agent.chat.send`, already scaled and cut by the renderer). The router keeps the valid ones (an image's header must give its stated size, within the limits) and stores them in `inbox_files` in the inbox transaction; the op's `data.files` lists them for the bubble. The model reads `<image n="0" name="…" width="…" height="…"/>` and `<file name="…">…</file>` before the words, and pi gets each image as an `ImageContent` part of that user message. The request builder sends pi's messages for the current run only, so an image goes with every request of the run it arrived in and never again: the archive keeps the marks, not the bytes. A complete run clears the bodies; an interrupted or failed one keeps them for Try again, which copies them to its op. The thumbnail stays for `agent.chat.image` until a removal deletes the rows. A message with files starts an untrusted run, as one beside a topic does. `agent.chat.reads` says whether the chat model takes images (`input` from OpenRouter's `input_modalities`, else pi-ai's entry; never for Codex).

**Sources** (`router/sources.ts`, plan v3 §19.1). Each Slack message a read returns in a run gets a handle, `m1`, `m2`, …, in the order the run first read it, kept in the `sources` table (so a resumed run or a replayed read keeps its handles). A read result line starts with the handle and names the channel and sender as the owner sees them, with the ids the tools take: `m3 #eng (C0ENG) ts 1760500000.000004, Maya Chen: …`. Inside a bubble the model marks words from Slack as `<src m="m3">…</src>`. The owner reads the words without the tags; the `bubble` event's `body` gives each span with its source resolved against the current run's table, and a handle the run did not read is plain text. The eval reads the same table (`sourceTable`). The chat server turns a bubble's spans into the contract's `JunoBlock`s (`router/rich.ts`): the small markdown subset SPEC 13.1 renders, with each source a `source` inline that keeps the marks around it. HTML the model writes maps to the same blocks or drops to its text, so a tag never shows. The prompt tells the model what renders.

**Reactions** (`reactions` table). Any one emoji, both ways, at most one per side per item; a null emoji removes it. The owner's thumbs up and removals are only recorded: no run, and the model never sees them. Any other owner reaction is also an inbox op (`react`): it joins a live run at its next step or starts one, and the model may ignore it, in which case the owner sees nothing. Juno's reactions come from `<react>` blocks on owner messages. A reaction is never a click and never a pin.

**A run.** The router commits the run (its history cutoff `H` and origin) before the input reaches pi, then resets and submits through `inbox/bridge.ts`. Every request goes through the builder and the guard. Input that arrives while a run is live is held in the inbox and handed to pi as a steer at the next boundary (pi's `afterTools` or `onYield`); pi places it right there, and with `steeringMode: 'all'` every message held at that boundary joins together. It is held until the boundary, not queued in pi at once, because pi keeps a queued steer after a failed run until the next input; held input that no boundary took starts the next run. The run ends with the chat contract's `Ending`: the builder's or guard's refusal (`blocked`, `interrupted`); a provider failure (`failed`, or `interrupted` when the stream had started and was lost); `complete` when pi answered every input. Owner runs carry `retry` on `interrupted` and `failed`. A steered report or wake, or a Slack read, marks the run as no longer clean (§6.4).

**Events** (`subscribe`): `started` (the status bubble, dots), `bubble` (one whole bubble, with its resolved sources; the dots go back below it while the run goes on), `status` (a tool's line, until the next bubble), `reaction` (either side, set or removed), `steered` (a held message was handed to pi), `remembered`, `ended`. `run()` gives the live run (its bubbles and status) for a renderer that attaches mid-run.

**Tools.** Each is a `defineTool` with a status line and a `replay` mode. A tool calls `current()` inside `execute()` to get the live run: its cutoff, whether it is clean, and the journal position read after pi committed the call's intent. A tool that authorizes an action (WP15) passes that `position` to `authorize` and keeps `replay: 'unsafe'`. No WP11 tool authorizes: `remember` writes a pin keyed by the call id, `delegate` starts a job keyed by the call id, and the Slack reads are Tier 0.

**`remember`** takes exact words the owner wrote in this run. The trusted side finds them among the run's owner messages (`[H, cutoff)`) and copies the bytes; the model never names a message id or offsets. "Remember this" (`pins.pinMessage`), edits and Undo name the pin version they replace.

**Testing.** `test/turns.test.ts` runs the engine in-process with `fakeProvider`; `test/turns-crash.test.ts` kills it mid-turn under the crash harness.

## Codemode for reads

Behind the `agent.codemode` flag (`TurnsOptions.codemode`; in the app `AgentConfig.codemode`, which main sets from `JUNO_AGENT_CODEMODE=1`), off by default. With it, the model also gets pi-durable's own `codemode` tool, which runs a model-written script in a QuickJS sandbox. Juno does not run scripts itself; `runtime/codemode.ts` scopes pi's tool, and `scripts/` decides what a script may call and records what it did. Research and measurements: `docs/research/codemode.md`.

- **Only reads.** A script's tools are an explicit list (`scripts/index.ts`, `SCRIPT_READS`): the Slack reads and `connection_read`, a script-only tool (`callers: ['tools']`) that runs a connection tool only when it is on Juno's reviewed read tier, never a tool the server merely marked read-only. The tool's `api.agent()` lists only those, its `api.executeTool()` refuses any other name, and the `pi.tool` hook refuses a script's child call that is not on the list. Writes, proposals, memory, schedules, jobs, T3 starts, the Codex harness and `codemode` itself are not callable, so a script cannot start a script. Writes keep the direct path and the auto-review. `models: false`; `store()` writes are dropped and `load()` reads nothing; pi has no `env`, so no output files.
- **Taint.** `codemode` taints the run before it runs, and each Slack read taints it again.
- **Sources.** A script's Slack read is the same tool, so its lines keep their handles (`m1`, …) in the run's `sources` table; a bubble cites what the script returned as it would cite a direct read.
- **Limits** (`SCRIPT_LIMITS`): 40 calls per script, 4 in flight, 60 s of wall time (the sandbox's deadline), 16 KB of result for the model, 64 MB of VM heap, 2 scripts at once (others wait for a worker). Over a limit the script gets an error it can read.
- **Admission.** The builder counts the `codemode` section and declaration with Juno's own; a tool only scripts call is in the section, not counted twice.
- **Audit** (`scripts/audit.ts`, `script_calls`). Each child call's arguments are written before it runs, and its outcome when it ends: done, failed, cancelled or refused. Activity shows a run's folded line ("Ran 1 script: 4 reads, 1 cancelled") and each call with its arguments and outcome; a call still running when its run ended shows "Did not finish".
- **Pause and AI off** stop a running script, also one waiting for a worker: its unfinished reads stop waiting (`abortable`) and are recorded as cancelled, and the model gets a fixed line saying why. There is no chat Stop (SPEC 13.2).
- **Packaging.** The app's build writes `quickjs.wasm` and `codemode-worker.js` next to `agent.js` and passes their paths (`apps/desktop/src/agent/index.ts`). Under Playwright with the flag on, the agent runs one script at start and writes `codemode-probe.json`; the packaged smoke test and `e2e/juno-agent/codemode.spec.ts` check it.
- **Not yet.** Codemode is not offered through the Codex harness. `test/codemode.test.ts` covers the flows; `bench/codemode.ts` compares it with direct tools.

## Actions (WP15)

Cards, clicks, dispatch and grants (plan v3 §6, §9, §12, §19.5; SPEC 13.3, 13.9; `specs/agent-actions.qnt`). `openTurns({ actions: { host, executors } })` opens them with the engine; `Turns.actions` is the service, and `startAgent` binds `host` to the AgentHost port.

| Folder | Does | Spec |
| --- | --- | --- |
| `policy/` | Pure rules: `authorizeDecision`, `toolDecision` (the tier table with the clean-run rule), `mayMintGrant`, `bindingMatches` | the guards of `authorizeWith`, `grantWith`, `grantClick`, `scheduleFromClick`, `scheduleFromMenu` |
| `grants/` | Mint a grant under one owner authority (a clean run, a current click, the message menu), find the live one, revoke | `grantWith`, `grantClick`, `scheduleFromMenu`, `pause`, `deleteSchedule`, `redact` |
| `actions/` | The card ledger (`cards.ts`), the dispatcher, the executors (the host's in `host.ts`, Juno's own in `proposals.ts`), the proposing tools, the migration set `actions` | `propose`, `click`, `authorizeDispatch`, `transportSend`, `recordReceipt`, `reject`, `lose`, `reconcile`, `resume` |

**A card's life.**

```text
tool call ─▶ proposal (payload, one intent per child) ─▶ click: approvals of the exact revision, digest and ordered children
  ─▶ dispatcher: policy check ─▶ authorize (consume) ─▶ attempt ─▶ executor ─▶ receipt: done | definite rejection: failed | unknown
startup: open authorizations ─▶ unknown (recovery) ─▶ reconcile once ─▶ done on positive evidence, else unknown (shows "Failed")
```

- **The model never writes a payload.** A tool names what it wants in plain arguments; the trusted side looks up places, mints UUIDv7 action ids and builds the exact `CardPayload` the card renders. The same tool call is the same card (`cards.call_id`).
- **A click** approves the stored revision, digest and every child in order (`bindingMatches`), under its op id: the same op again is the same click. A card takes one click, and a dismissed, expired or clicked card takes none. It is durable before the RPC answers (`approval.committed`), and dispatch follows in the background.
- **The dispatcher** drains approved children in click order, one at a time. It reads the facts and commits `authorize` in one synchronous step, so the policy decides on what is committed. Paused, off, not the owner, or no Slack account known yet: the click waits, and Resume, a presence change or `actions.kick()` (WP21, when this Mac becomes the owner) runs it. Anything else that fails the policy (stale, expired, source changed by a redaction, account changed, no executor, already authorized) is written on the approval and the click never runs; the card reads "Expired" or "Failed". One authorization is one attempt, executors never retry, and a child whose destination does not deduplicate is never authorized twice (`noRepeatAuthorization`). There is no retry button.
- **Executors** run one child by its tool (`Executor`): `slack_send` and `topics_resolve` through the host's single-attempt RPCs; `delegate` (a Proposed task's Start, which also mints the job's grant), `spend_raise` (Allow $1 more today) and `juno_answer` (a question's answer goes to the model as a `click` op). A host error means the host refused before recording anything: failed. A lost answer is unknown. Reconcile looks for positive evidence once per start and never makes a second attempt.
- **Grants**: a `delegate` in a clean owner run mints the job's grant under `cleanRun`; a Start click under `click`; the menu's reply watch under `menu` (WP19 calls `mintGrant`). Pause and AI off revoke every grant before the mode changes; a job's Stop revokes its own; WP16's removal calls `revokeExposedGrants(store, runs, gen)` inside its transaction: it revokes the grants minted by runs that saw the removed messages (found through the grant's op: a run input, a clicked card's run, or the job's run; a menu grant read nothing and stays) and carries the rest into the new generation, so an unrelated schedule keeps waking. Resume restores none, and one authority op mints a target's grant once, so a replayed call cannot restore a revoked grant.
- **Untrusted content forces a card.** `toolDecision` turns a no-click call into a card once the run has read Slack, a connection or a report; `delegate` then proposes a Proposed task with the Because line "Juno read Slack or a report in this reply". Sending to Slack is a card in every run.
- **Connection calls are auto-reviewed** (decision of 10-16, SPEC 13.9, plan v3 §6.4a). See "Auto-review" below.
- **What the model learns** (§19.5). A dismissal, an expiry and a settled click leave one outcome per card. The next input the model reads, of any kind, carries them first: `<card-outcome card="…" kind="sendMessage" outcome="declined|expired|done|failed">summary</card-outcome>`. It starts no run. The text is escaped, so it cannot close the tag, and a pin never covers it (`ownerWords`). A reply to a card quotes its summary.
- **A batch** settles row by row: a row refused after another row ran reads Failed ("Sent 1 of 2"); a card whose click never ran because it expired reads Expired.
- **Activity** lists a run's settled cards and no-click job starts (`activityActions`); an open card has no decision yet and is not listed.
- **The Budget card** follows a run that ended `blocked: budget`, one per day and raise.
- **Spend**: Allow $1 more today is `spend.allowDollar(clickOpId)`, keyed by the click.

**Writes in the app.** The host still refuses Slack sends while its writes are disabled (`agentHostHandlers({ writes: 'disabled' })`, WP13a), so a click in the app shows "Failed" and nothing reaches Slack. Tests turn writes on with `fakeActionHost` (`@juno/agent-testing`).

**Tables** (`ACTIONS_MIGRATIONS`, replicated): `cards`, `card_revisions`, `intents`, `approvals`, `grants`, `action_results` (Activity's detail for a failed or unknown authorization) and `card_outcomes`. The core's `authorizations`, `attempts` and `receipts` hold the rest; `authorizations.intent_id` names an `intents` row.

**For the next packages.**

- WP16 (redaction, built): in the removal's transaction, bump `memory_head.gen` and call `revokeExposedGrants(store, runsThatSaw, gen)`, which revokes only the grants minted by runs that saw the removed messages (spec `redact`, pairs `redactExposed` and `redactUnrelated`); open cards proposed in the old generation expire and a waiting click is refused (`sourceChanged`). Register an executor for the `remove` card's child (the card's choice is in `args.choice.alsoRemoveReply`).
- WP17 (MCP): register one `Executor` per write tool through `openTurns({ actions: { executors } })` with `deduped: false` unless the server keeps a key, a `check` for the schema hash and preconditions, and a `reconcile` that reads back. Propose `change` and `connect` cards with `actions.propose`. A read runs; any other call goes through the auto-review ("Auto-review" below).
- WP18 (T3): register `t3_start` (deduped: false; reconcile by the tag `juno:<action id>`), mint the job's grant on Start with `mintGrant({ authority: { _tag: 'click', current: true } })`, and decide `t3_send` and `t3_stop` with `toolDecision('steer' | 'stopJob', run, { liveGrant })`.
- WP19 (schedules): `toolDecision('scheduleCreate', run)` gives run or card; mint the schedule grant with `mintGrant({ opClass: 'schedule', authority })` for a clean run, a `proposedSchedule` click (register its executor) or the menu (`{ _tag: 'menu' }`), revoke it with `revokeGrant(store, 'schedule', id, 'delete')`, and register the `schedule` card's executor (its choice is `args.choice.action`).

`test/policy.test.ts` checks the pure rules with properties; `test/actions.test.ts` runs every card kind on the engine (click, consume, send, receipt, unknown, dismiss); `test/actions-crash.test.ts` kills the agent at `approval.committed`, `authorization.consumed` and `attempt.beforeReceipt`.

## Auto-review

A connection (MCP) call that is not a read runs once with no click or shows its Change card, as the owner's rule and one review decide (`mcp/tools.ts` `call_tool`, `mcp/reviewed.ts`; spec `reviewAllows`, `reviewGated`, `untrustedNeverAuthorizes`).

| Piece | Where |
| --- | --- |
| Reads: the code's read list with an unchanged schema (`isRead`). Read-only at first sight with an unchanged schema (`isHinted`). Locked rules (`lockOf`) | `mcp/catalogue.ts` |
| Tool switches and rules: `mcp_tools.enabled`, `mcp_tools.review`, `mcp_tools.fresh`, `mcp_connections.review`; `setTool`, `setRule`, `rule` | `mcp/schema.ts`, `mcp/manager.ts` |
| The review: the owner's words in the run (`ownerWordsInRun`), the request, the spend reservation, the 3 s limit | `review/review.ts` |
| The decision model: Jev on OpenRouter through pi-ai `classify`, no retry; none without an OpenRouter key | `providers/review.ts` (`reviewModel`) |
| The rules: `needsReview`, `reviewDecision`, `floorRisk`; `authorizeDecision` with `review` | `policy/policy.ts` |
| The rule, the review and the decision for one call (`reviewChange`); a call that runs: a quiet card, an `mcp_reviews` authority, authorize, attempt, `runWrite`, settle (`runReviewed`) | `mcp/reviewed.ts`, `mcp/actions.ts` |

- **The rule** (`ruleFor`, `manager.rule`) is Always ask for a delete (a tool named like one, marked `destructiveHint`, or a call with a delete argument), and for T3 Code's generic tools (O3). Otherwise it is the tool's own unless it is Auto, else the connection's; but a tool with `fresh = 1` (its schema changed, or it appeared while the connection was Never ask) does not follow the connection's Never ask, until the owner sets a rule on it or on the connection. A tool named like a merge, purchase or force-push, or a call whose arguments name one, is never offered or called (`forbidden`). Always ask: a card, no review. Never ask: no review when the run was clean when the model wrote the call (`ToolRun.cleanAtRequest`; a call's own taint at its start does not count), else a review that must find the intent at least implied and the call reversible. Auto: a review that must find it explicit and reversible. `runReviewed` reads the rule again after its last await, just before it authorizes, and asks if the rule now asks.
- **Read-only marks.** A tool the server marked `readOnlyHint` when Juno first saw it, with its schema unchanged (`hinted`), runs as a read (`invoke(..., 'hinted')`) only when the run was clean when the model wrote the call and the rule is not Always ask. Otherwise it is reviewed like any other call.
- **The review** reads only `{ owner, call }`: the text of the run's `send`, `steer` and `retry` inputs (never quotes, reports, wakes or tool results), and the call's server label, tool name and arguments. It reserves on the `chat` path before the call and settles with the reported cost, or keeps the reservation. No model (another provider than OpenRouter), no budget, an error, a timeout or an answer outside the choices is `failed`, and the call asks. A permissive answer below 0.6 confidence counts as the next safer one. `floorRisk` makes a call named like a delete, with a destructive argument (`archived`, `in_trash`, a delete `command`), or marked `destructiveHint` never reversible.
- **The card** carries the review in `ChangePayload.review` (`{ rule, intent?, risk?, failed?, line }`), and the view shows the line. The line is fixed copy (`chatCopy.card.change.review`), never the model's.
- **A call that runs** is a card row with `quiet = 1`: the chat never lists it, it takes no click, and it leaves no card outcome (the model has the tool's result). Its single-use authority is an `mcp_reviews` row passed as `grantId`. It is authorized only if `authorizeDecision` allows it with `review: true` (mode, owner, validity, no earlier authorization), attempted once and settled as a click is; an unconfirmed result is `unknown` and never retried. If it cannot be authorized the quiet card is dismissed and the model is told nothing was done. Activity lists it as `noClick` with the review.
- **Disabled tools** are left out of `definitions` (so `find_tools` never offers them and they get no executor) and refused by `tool`.

**Discovery is progressive** (`mcp/discovery.ts`; see [the MCP hand-off](src/mcp/README.md), "Discovery and execution"): a bare `find_tools` returns the servers that are on with their state and tool counts; a `query`, optionally with a `server`, returns matching tools one line each; a tool's argument schema comes only when the model names that tool. Servers are named by handles, so internal ids, schema hashes and addresses never reach the model. `test/discovery.test.ts` measures the bytes of each step.

`test/auto-review.test.ts` runs the flows on the engine with `fakeReviewer` (`@juno/agent-testing`); `test/policy.test.ts` checks the rules with properties.

## Redaction (WP16)

`src/redaction/` removes messages (plan v3 §4.5, §14.4; SPEC 13.8; specs `agent-memory.qnt` `redact` and `purge`, `agent-recovery.qnt` `raiseDeletion` and `redact`, `agent-actions.qnt` `redact`). `Turns.redaction` is the service; `openTurns({ backup })` takes the backup's hooks.

| File | Does |
| --- | --- |
| `scope.ts` | Pure rules: what a removal reaches (`removalScope`), whether Juno's reply follows (`replyOf`), the runs that saw it (`runsThatSaw`) |
| `redaction.ts` | The removal, in order, and the purge |
| `card.ts` | `remove_messages` (the model proposes a Remove card) and the card's executor |
| `quotes.ts` | Quotes of removed items in later replies and reactions become the placeholder; pins on those messages move |
| `schema.ts` | `REDACTION_MIGRATIONS`: `removals`, `removed_ops`, `removed_bubbles`, and the local `redaction_purges` |

**What a removal reaches.** A message is its whole pi entry (every chunk). An owner input also takes every entry of the same words sent again ("Try again" is a new op). "Also remove Juno's reply" takes everything the run wrote after the input and before the next one: Juno's words and tool calls, and the tool results, which can echo the owner's words (`remember` does).

**One removal, in order.**

1. The backup's `raiseDeletion(gen + 1)`, before anything else (G13). A crash here leaves the record ahead and nothing removed (`redaction.deletionRaised`).
2. One transaction: `redactMemory` (in `store/memory.ts`) tombstones the messages (text cleared, ids kept, `redactions` rows), masks every view line whose node depends on them, moves `gen` and queues rebuilds. Then the attachments go, the inbox ops' text is cleared, pins sourced from them are deactivated and every version's text cleared (bumping `pin_rev`), quotes of them in later replies and reactions become `<quote from="…" removed="true"></quote>` in the archive (`quotes.ts`: the quoting message's version moves, its summaries are deleted and rebuilt, and its pins find their words again), removed Juno bubbles are recorded in `removed_bubbles` so later quotes of them render the placeholder too, remove cards that name them lose their preview line, `revokeExposedGrants` revokes the grants minted by runs that saw them and carries the rest into the new generation, and reports waiting in the inbox from jobs started in runs that saw them are failed with `removed`. The moved `gen` expires every open card, refuses a waiting click (`sourceChanged`), refuses a request built before it at the guard, and makes a running compaction job's publication stale (`redaction.committed`).
3. Right after the commit, `invalidateChatCaches(store)` (`serve/chat.ts`) drops every cached chat page, quote and row index, and wakes the pages' subscribers, so the Removed note shows at once. Jobs started in runs that saw the messages are stopped, as their Task card's Stop does.
4. The purge, one durable step at a time, in order, retried on the memory queue's delays: `purgeNodes` (node versions that depend on a removed message) and a truncating checkpoint, `purgeCodexThreads` (`providers/codex-purge.ts`: the session files of every recorded Codex thread), the journal (the router rotates between runs, which deletes the old file), then the backup's `regenerate(gen)`. One run of a step settles every removal waiting on it. Startup resumes it (`redaction.purged`).

The same op again is the same removal; a removal of messages already gone changes nothing. Removals run one at a time.

**The `remove` card.** `remove_messages({ messages: ['n12'] })` names owner messages by handle; the trusted side builds the card with each message's first line and time, and `offerReply` when Juno's reply follows the first. Its child is Tier 3 and deduplicated; the click runs the removal under `card:<action id>` with `args.choice.alsoRemoveReply`, and reconcile finds it by that op.

**Free space.** `agent.sqlite` runs with `secure_delete = ON`: SQLite zeroes deleted content, freed pages included. FAST mode is not enough. A message over one page (4 KB) lives on overflow pages that are freed whole, and FAST leaves freed pages as they were; a probe found a cleared 16 KB message still in the file under FAST, and none under ON. The zeroed pages reach the main file only at a checkpoint, so the purge's first step ends with `wal_checkpoint(TRUNCATE)`, which also empties the WAL. The flow tests scan `agent.sqlite` and its WAL for the removed words, and fail with `secure_delete` off. The filesystem and the SSD may still keep old blocks; forensic erasure is not promised.

**Cost** (`bench/commit-cost.ts`, 2026-10-15, three runs on the Mac at load 2 to 4, minimum per commit). At FULL with `fullfsync`, every commit takes 1.5 to 3.5 ms either way, and `secure_delete` is inside that noise. Without `fullfsync`, which shows its own cost: clearing a 16 KB message 0.050 to 0.054 ms without it, 0.081 to 0.082 ms with it (it writes the freed overflow pages as zeros); projecting a 16 KB message 0.55 to 0.58 against 0.58 to 0.65 ms; small rows (accept, project, clear) within 0.01 ms. So it adds at most about 0.07 ms to a commit that costs about 2 ms at FULL.

**Not covered yet.**

- Payloads of other cards proposed in runs that saw the message: they expire, and their text stays in the ledger.
- The Settings line "Removal pending · 1 copy in a running job" is not shown: jobs are stopped at the removal, and the journal rotates at the next run boundary.

`test/redaction-scope.test.ts` checks the pure rules with properties; `test/redaction.test.ts` runs removals on the engine (every place the words lived, a removal racing a running compaction, stale work refused, the Remove card, the owner's sheet through the renderer); `test/redaction-crash.test.ts` kills the agent at `redaction.deletionRaised`, `redaction.committed` and after each purge step.

## Settings › Juno

`src/settings/settings.ts` serves the page and the owner's changes over the running engine (SPEC 13.10, plan v3 §7.1, §5.4). The owner's choices are one row of `juno_settings` (`SETTINGS_MIGRATIONS`, replicated): the chat family, the compaction family, the custom endpoint's model and the cap for days not yet started.

- **Provider.** Main says which is active and sends it (`providerConnection`); the page's `provider` is `custom` for an endpoint. A switch reads the new provider's models and moves the engine to the saved choice there.
- **A custom endpoint** (`providers/custom.ts`): rows are what `GET <baseUrl>/models` lists, by id, read at every refresh; when it lists none, `modelTyped` is set and the owner types an id (`{ _tag: 'model', provider: 'custom', family: <id> }`). Compaction uses the chat model. A reported window (`context_length`, `max_model_len`) is used, else 262,144 tokens; OpenRouter-style `pricing` is used, else the model costs $0 and `spendUntracked` is set. Requests use the plainest chat-completions shape (`max_tokens`, no `store`, no developer role) and send the key, or `none` when there is no key.
- **Fallback on OpenRouter.** `fallbackModels` lists every family; the saved one (`fallback_family`, Gemini Flash by default, `none` for off) is selected. A change with purpose `fallback` and family '' turns it off. The guard asks it as above, and `tellFallback` (`settings/engine.ts`) sends its slug (`fallbackSlug`: the picker's row, else pi-ai's newest of the family) to the host over `host.ai.fallback` on every change and every presence, so the engine's AI jobs use the same model. Absent on a custom endpoint.
- **Models on OpenRouter.** One row per family, labelled as the owner sees it ("Claude Sonnet"), with the resolved model ("Claude Sonnet 5.5"), the provider and the price per million tokens. A family with no usable model has no `resolved`. A change saves the family and calls `Turns.setModels`: the chat model applies from the next run (the router reconfigures pi's root conversation between runs, `beforeRun`), the compaction model from the next compaction job. The catalogue is checked every hour and read at most once a day; when the rows change, the guard takes the new models (`refreshModels`) and the saved families move to their newest model. Codex rows come with WP20.
- **Spend.** Today's spend is the ledger's actual plus unknown spend; the cap is today's. A new cap applies today (`setCap`, refused below what today has committed) and is saved for later days.
- **The key.** A run that ends `failed: keyRejected` marks the active provider's key (`openRouterKey: 'rejected'` or `customKeyRejected`), and a change from main clears the mark. Whether each key is set is main's `ProviderState`.
- **Pause** sets the run mode and asks every running job to stop. It is refused while the mode is `off`. Settings change with AI assist off too.
- **Rules** are the owner's lines (`actions/rules.ts`, the `owner_rules` table): replaced as one list, each one line of at most 280 bytes, at most 20. The model reads them with Juno's instructions. They can only make Juno ask more; tiers and cards are enforced in code.
- **Backup and This Mac** (WP21): the backup folder (`agentDir/backup` by default), the last backup's time, when the recovery phrase was exported, and who owns Juno's state (`active`, `released` with the move code or the other Mac's name, or `recovery` with the pending count). `{ _tag: 'backupFolder' }` takes an absolute path and starts a generation there. Move, restore and Activate are `agent.settings.ownership` and `agent.review.activate`.
- **Not served yet**: Codex status (shown `missing`).

## The chat server (WP13b)

`src/serve/` serves `AgentRpcs` to the renderer on the ports main brokers (ADR 0012). `rendererServer(transport, { turns, presence, presenceChanges, settings? })` is the layer; `startAgent` builds it when given a `renderer` transport.

- **The page** (`chat.ts`) is built from the agent's records on every change: owner messages from the inbox (`send` and `steer`; a `retry` is the same message again, so it is not a second bubble), each run's bubbles parsed from its archived text (the live run's from the router), endings from `runs`, the latest reaction per side and item, day separators, the "New" divider and group positions (same sender, within two minutes, same origin). Each bubble is timed by when it was first shown (`chat_bubbles`): when the model closed it in a live run, or its archive row's time for a bubble the server never saw live. That time never changes, so the order and the read state hold when the run ends and across a restart mid-run. A window is cut from the whole list; anchors are any row's own id.
- **Read state** is one mark in `chat_read` (`CHAT_MIGRATIONS`, replicated tables): Juno's bubbles at or before it are read. `agent.chat.read` takes a bubble or an archive message and only moves the mark forward.
- **The banner**: `updateNeeded`, then `aiOff` (AI assist off in Juno, or the mode is off), `paused`, `offline` (the host is not live), else `none`. The composer is off for `updateNeeded` and `aiOff`.
- **Commands**: send, react and retry go to the engine's inbox and answer after the commit; a second Try again for the same failure names the retry already queued; `tooLong` and a failed write (`notDelivered`) come back as errors. With AI assist off they answer `unavailable`.
- **Cards** (WP15): the page lists every card at the time Juno proposed it, and each job's Task card at the time it started; `cards` carries the `CardBinding` of each open card in the window, plus an identity with no children for Ask again on expired cards. `agent.cards.approve`, `dismiss` and `editMessage` answer after their commit; a click or edit on a card the owner no longer sees is `stale`, on an expired card `expired`, on a card that does not take it `invalid`. `prepare` writes a button's data (an option, a reply, Keep, Pause or Delete on a schedule) into a new revision and returns the binding to approve; a button with no data returns the card's current binding. `askAgain` on an expired card sends the owner message "Ask again", replying to the card. `undo` answers `unavailable`.
- **The Juno menu's pages** (`pages.ts`) are rebuilt on the same signal. What Juno remembers lists the active pins with their source message; edit, remove and "Remember this" check the pin's (or the message's) version and answer `stale` when it moved. Memory of this chat is the published view as a timeline, each line dated from its messages' earliest to latest time, and rechecked every 2 s because compaction publishes between runs. Activity lists each finished run: who asked ("You", a job's title, "A schedule"), when, the outcome (`stayedQuiet` when a complete run said nothing), whether it read untrusted content, and its actions (`actions/activity.ts`): each action the run proposed (one per message in a Send card) with its decision (approved, dismissed, expired, refused), outcome and a plain failure line with the detail behind Copy details, and each job it started with no click. The folded read line is not built. Scheduled lists persisted schedules and reply watches; Review streams an empty page. Connections streams the MCP manager when `ChatHost.connections` is supplied. Memory and Activity page with `{ cursor?, limit }`: the newest `limit` rows before the cursor, oldest first, and `moreAbove`.
- **Remove** (WP16): `agent.chat.remove` runs the owner's removal (`Turns.redaction.remove`) and answers once it committed. It works paused, offline and with AI assist off; only a missing engine or `updateNeeded` refuses it, and a message that is not in the chat is `stale`. A removed owner message is a `removed` note in its place, and a quote of it reads Removed.
- **Review and ownership** (WP21) are served by `ownership/` and `backup/`; see "Ownership and backup".
- **Not served yet**: Codex sign-in (WP20). Its command answers `unavailable`.
- **What a message is about.** A message's `context` (a topic from the Juno panel, or a person or channel from Ask Juno) is stored with the op, reaches the model as an `<about>` element inside `<message>` (`router/input.ts`), and shows as the owner bubble's `about` line. A topic context is Slack content, so the run starts tainted, or is tainted when the message steers it.
- **Cost**: each change rebuilds the whole list with a few queries, and parses finished runs' text again. That is fine for M2; a 5,000-message chat will want finished runs cached, against the budget in `docs/performance.md`.

`test/serve.test.ts` and `test/juno-pages.test.ts` run the server on the real engine with the scripted model, through an RPC client on a Node `MessageChannel` (`test/serve-harness.ts`). `packages/state/test/agent-chat.test.ts` runs the renderer's atoms against it.

## MCP connections (WP17)

`src/mcp/` owns HTTP connections, loopback OAuth sign-in, tool discovery and tier decisions, the two fixed model tools, Notion's version checks and read-back, and the per-turn MCP endpoint for WP20. See [the MCP hand-off](src/mcp/README.md) for bootstrap, credential bridge and WP14 wiring, tests and the owner-only live check.

`startAgent` runs the manager when given `mcp: { credentials }`; main's keychain bridge supplies them in the app. Contract additions: `agent.connections.add`, the `remove` action and `ConnectionRow.removable`; `credential`/`credentialReply` between the agent and main; `ActionsOptions.executors` accepts a callback for discovered tools; `TurnsOptions.tools` registers fixed adapter tools before resume; `ChatHost.connections` serves the Connections routes; discovered rows carry an optional `schemaHash` (always present from the manager). The request builder pages MCP results over 20 KB using ordinary archive attachments. No action protocol changed.

## Scheduler (WP19)

`src/schedule/` implements persisted occurrences, grant checks at admission and
start, reply watches, schedule tools and card executors. Its page and commands
are wired by `startAgent`; `openTurns` starts the scheduler and registers its tools and executors. See
[`src/schedule/README.md`](src/schedule/README.md) for the router and host
runtime, the message-menu RPC and reply-based Send card expiry.
`mintGrant` now joins a caller's transaction so a schedule and its grant commit
together.

## Sidebar view tool

`src/view-tools/` owns `juno_views`, the local sidebar settings tool and its
Undo records. It uses WP15's policy and Change cards, and binds the AgentHost
view routes at startup. See [the tool README](src/view-tools/README.md).
`slack_channels` finds all cached channels by name glob without reading messages.

## Ownership and backup (WP21)

`src/ownership/` and `src/backup/` implement plan v3 §14 and the `agent-recovery.qnt` transitions named below. `openTurns` builds both when `TurnsOptions.backup` gives main's keychain (`BackupKeychain`) and this Mac's name; without it Juno keeps no backup and cannot move. `Turns.ownership` and `Turns.backup` expose them.

**Ownership** (`ownership/`). The core `ownership` row (`device_id`, `epoch`, `state`) is local; the backup manifest carries it instead. The dispatcher authorizes only while `state = active`, and the router starts or steers a run only then (`RouterOptions.admits`).

- **Move** (`ownership.move()`, spec `releaseOwner`, `drain`, `checkpoint`, `publishRelease`): `released` commits first, so no click can authorize after the drain; then the live run, dispatch already handed off and projection finish; then the final checkpoint (a new generation) is published with `state: released` and the move code (8 characters of the manifest's hash). A crash after the release reopens released, and `resume` or Move again finishes; a final manifest already published is reused, so the code does not change (`ownership.released`). Running jobs are not stopped: their reports after the checkpoint stay on the old Mac.
- **Restore** (`ownership.restore(folder)`, spec `beginRestore`, `replay`, `install`): stages the newest manifest the key authenticates into `restore.sqlite` and calls `restart`. The next open installs it before `agent.sqlite` opens, rechecking the deletion record (G11), then `enterRecovery` and `adoptRestoredKeys` (a key that came from the phrase becomes this Mac's backup key, and the deletion record becomes the restored store's): a new incarnation, this Mac's device id with the backup's epoch in `recovery`, and every click not yet authorized deleted, so it never runs without a new click. Authorizations without a receipt become `unknown` at recovery as usual.
- **Review and Activate** (spec `review`, `activate`): in recovery every open card shows `mayHaveHappened` (`ownership.restored`), sends wait (`waiting: review`), and a click waits. `activate({ backupAt })` names the restore the owner reviewed; it expires the cards still open, takes `epoch + 1`, and calls `actions.kick()` and the router's kick, so reviewed clicks and waiting sends run once.
- **A stale owner** (G7, spec `observeOwner`): before each write the backup reads the newest manifest in the folder. Another Mac at a higher epoch turns this Mac `released` (`deviceName` set; the chat banner is `otherDevice` and every command is refused `readOnly`). Before that read both Macs can act: `staleOwnerCannotAuthorize` stays a counterexample.

**Backup** (`backup/`). One generation at a time in `<folder>/g000007/`: `snapshot.bin`, `segment-<n>.bin`, `manifest.json`.

- **Capture** (S6): a snapshot is `VACUUM INTO` with local rows deleted; a segment is one **patchset** per replicated table. Patchsets, not changesets: a changeset holds old row values, so a segment cut after a removal would carry the removed text. Sessions attach only to replicated tables (G12). A replicated table must have a primary key.
- **Keys**: the backup key (keychain) wraps a fresh data key per generation and authenticates manifests (HMAC). Segments are AES-256-GCM with a counter nonce reserved in `backup_progress` before use, and associated data binding generation, position and the previous segment's hash. Export recovery phrase makes a phrase, gives it to the keychain (`recoveryPhrase`) for main to show, and every later manifest carries the backup key wrapped by it (scrypt).
- **When a generation starts**: none yet, the last close was not clean (changes before a crash were never captured), the deletion record is ahead of the generation and of the data (G13: the record was raised and the removal never committed), the schema or the set of tables changed (a patchset holds no schema, so a migration starts a generation instead of a schema segment), the folder changed, or an export failed after its cut. Otherwise an export cuts a segment, renames the manifest, then moves the export cursor (spec `exportAfterManifest`). A new generation's manifest is renamed before older generations are deleted (spec `shred`).
- **Removal** (WP16's `RemovalBackup` is `backup.removal`): `raiseDeletion(gen)` raises the keychain record before the removal commits; the purge's last step calls `regenerate(gen)`, after the node versions that depend on the removal are gone, and it snapshots then and deletes the older generations. A committed removal never starts a generation earlier, so no snapshot is taken before the purge. A generation's `label` is the removals its snapshot excludes: the memory generation, less any removal whose `nodes` purge step has not run, or the record when the removal behind it never committed. A restore with a trusted record (this Mac's keychain when this Mac's key opened the backup, or a move's manifest) refuses a generation whose label is below it. Without one it restores and the Review page shows `unchecked` (`staleFolderCannotRestoreRemoved` stays a counterexample; the strict phrase option is off by default and not built).
- **A folder Juno must not write over** (`ForeignBackup`): a manifest this key cannot verify (a new Mac pointed at the old Mac's folder before restoring), or one from another Mac at the same epoch (this Mac's own earlier install). Writing would delete the backup the owner may restore.
- **A folder change** records the old folder in `backup_progress.retired`; this Mac's generations there go once a generation is published in the new folder, even after a failed first try.
- Exports run every minute when something changed, and at close.

**In the app** (`apps/desktop/src/agent/index.ts`): `turns.backup` gets main's keychain through `keychainBridge` (`secret`, `secretReply`), this Mac's computer name, and `restart`, which tells main and exits so the renderer's streams reconnect to the new process. A folder change answers once the first backup is in the new folder, and it checks the folder can be made and written before the setting changes. A failed folder change, export, move or restore answers with one plain line from `backupFailure` (a folder Juno can't write, one that is not available, a full disk, another Mac's backup, the keychain); `onReport` logs the error's code and message. Settings › Juno shows the line under its row or in its sheet.

Tests: `test/backup.test.ts` (Macs in-process: round trips, segments, a move, a voided click, a stale owner, WP16's removal and the regeneration, a record ahead, the key and record after a restore, the folder rules), `test/ownership-serve.test.ts` (the RPCs, banners and Review page) and `test/backup-crash.test.ts` (kills at `backup.segmentWritten`, `backup.manifestRenamed`, `ownership.released`, `restore.staged`, `restore.swapped`).

## Message menu and network admission

The desktop supplies `TurnsOptions.online` from host presence. Queued inputs stay durable in the inbox while offline; `networkChanged` wakes the router when the host socket returns. Ownership, mode and network availability are checked together before a new run. Slack sign-in is separate from network availability, so local Codex works before a workspace is connected.

`agent.chat.message` resolves a displayed owner message or Juno bubble to its archive entry and the local Remove sheet. The renderer captures selected UTF-8 byte offsets before opening the native menu. Remember uses the existing version-checked pin route; its operation id is the pin id, so transport redelivery cannot create a second pin. Active pins appear below their source with Undo until the next send or one minute. Removal uses the existing redaction transaction and purge hooks.

`topics_resolve` always proposes a Tier 3 Resolve card. The host uses the user's local topic command, and the settled card keeps Undo across restart.
