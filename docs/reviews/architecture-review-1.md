# Architecture review 1

Date: 2026-10-12. Reviewed: `docs/architecture.md`, ADRs 0001 to 0006, the spec, the three research notes, `docs/development.md` and the M0 scaffold.

How I checked: I read the installed `effect@4.0.3` source in `node_modules`, the `@effect/sql-sqlite-node@4.0.3` tarball and the Electron 44.7.0 typings. I also ran a throwaway Electron 44 script outside the repo. It forked a utility process, passed a `MessageChannelMain` port to a sandboxed renderer through the preload, called `net.fetch` from the utility process with a `partition` session, and killed the engine. I ran `node:sqlite` inside Electron's Node 24.21 to check FTS5.

## Verdict

The overall shape is right: an engine in a utility process, SQLite as the read model, an outbox, a derived topic index with a client-only overlay, dumb views and a fake Slack server. The weak spots are not structural. The sync rules are too thin for how Slack really behaves: merge order, echo handling, read-state conflicts and discovery gaps. The network layer also ignores an Electron feature that removes a whole class of session bugs. The package split costs more than it returns at this stage. Fix the top five before M3.

## Findings, ranked by impact

### 1. Use Electron `net` with a session in the engine, not Node `fetch` plus a hand-held cookie

**Problem.** ADR 0001 says the utility process must use Node `fetch` and `ws`, and that the engine attaches the `d` cookie itself. That is not true. In Electron 44, `net` is available in the utility process, and `utilityProcess.fork` accepts `session` or `partition`. I verified that `net.fetch` in the utility process sends cookies from a `persist:` partition and stores `Set-Cookie` responses back into that partition.

**Failure.** With Node `fetch`, Juno ignores any `Set-Cookie` that Slack sends to refresh or rotate the session, so the session can die early while the official client's session stays valid. Node `fetch` also ignores the macOS system proxy, PAC files and keychain CAs. Many corporate and Enterprise Grid users sit behind exactly that, so every API call would fail there. Node's TLS fingerprint is not Chromium's either, which matters for a client that pretends to be the official one.

**Change.** Main stores the `d` cookie in a `persist:slack` session. It forks the engine with `partition: 'persist:slack'`. `SlackApi` uses `net.fetch`, so the engine never sees the cookie for HTTP. Put this behind an `HttpTransport` service: tests under plain Node use a `fetch` implementation pointed at `fake-slack`. The socket still needs `ws`, because `net` has no WebSocket. Before each connect, the engine asks main for the current cookie (read from the session). Set `Origin: https://app.slack.com` as well as `User-Agent`. Thumbnails through `juno://files` then use the same session.

### 2. Sync has no merge rules, so history pages, socket events and reconnects will corrupt rows

**Problem.** Section 5 says rows are "upserted, not duplicated", and ADR 0003 says sync must be idempotent. Neither says which write wins.

**Failure.**
- A history page requested at T1 arrives after a `message_changed`, `message_deleted` or `reaction_added` event at T2. A plain upsert reverts the edit, brings back the deleted message, or drops the reaction.
- A socket message moves `newest_synced_ts` past a gap left by a reconnect. The gap is never filled.
- Edits, deletes and reactions on older messages during a disconnect are lost. "History since cursor" only returns new messages.
- A reply arrives for a root that is not in the store. Section 6 updates the counters of a root row that does not exist.

**Change.**
- Write merges field by field, with guards. A tombstone always wins. `reply_count` and `latest_reply` take the max. Edits apply only if `edited.ts` is newer. Reactions from a page apply only if no event for that message arrived after the page request started (store `last_event_ts` per message).
- Socket events never move the history cursors. Keep explicit synced ranges per channel.
- On reconnect and warm boot, pass `cached_latest_updates` and apply the `latest_updates`, `unchanged_messages` and `deleted` fields that `conversations.history` and `conversations.replies` already return (research section 3).
- A reply for an unknown root creates the thread topic with a stub root and queues a fetch of that root.
- Add a seeded, randomised engine test: interleave fake socket events, page responses, drops and outbox sends, then assert that the store equals the fake's state. It replaces most of the 24-hour soak and runs in seconds.

### 3. Echo reconciliation only handles the happy path

**Problem.** Section 5.6 replaces the pending row only when the socket echo arrives.

**Failure.**
- The socket is down during the send, so no echo arrives. A later history page then inserts the real message under its real `ts` next to the pending row, which has a different primary key. The user sees the message twice.
- A timeout or 5xx after Slack accepted the post leads to a retry, and the message is posted twice in Slack.
- An edit or delete of a still-pending message has no real `ts` to target.

**Change.**
- Key pending rows by `client_msg_id`. Reconcile on whichever comes first: the `chat.postMessage` response (it returns `ts` and `message`), the socket echo, or a history or replies page that contains the same `client_msg_id`.
- After an ambiguous failure, check recent history for the `client_msg_id` before retrying.
- Outbox items that need a real `ts` resolve it when they run, and wait for the post they depend on.
- Coalesce outbox items: many `mark` calls for one target collapse to the last one, and an add/remove reaction pair cancels out.

### 4. Read state has two writers and no conflict rule

**Problem.** `topic_reads` is called "Juno's truth", but the official client writes the same Slack watermarks.

**Failure.**
- Juno marks a channel unread. A stale `channel_marked` event from before that change arrives afterwards and marks it read again.
- Main and client-only groups share one Slack channel watermark. Reading Main marks Slack read only up to the last ungrouped message, so Slack keeps showing grouped messages as unread. Reading a group cannot be mirrored at all.
- Unread counts come from messages in the store. A channel with 400 unread messages and one 100-message page shows "100".
- Opening a topic runs `topic.markRead` immediately. The live snapshot then removes the "N new" divider the moment it appears.

**Change.**
- A local change that is still pending in the outbox wins. Once it is acknowledged, server events apply in `event_ts` order. Ignore events older than the last acknowledged local write.
- Define the Main-and-groups mapping. Suggestion: the Slack watermark is the earliest unread point across Main and all its groups.
- Use `client.counts` (`has_unreads`, `mention_count`) for Main. Show an exact count only when local history covers everything since `last_read`.
- When a topic opens, the container stores the divider position from the read pointer at that moment. That is view state, not store state.

### 5. The thread discovery gap is bigger than stated, and the product decision it depends on is still open

**Problem.** Section 5.2 accepts one gap: an old root with a new reply is not found at cold boot. The same gap exists at every warm boot and reconnect. Warm boot only fetches history for conversations whose `latest` moved. A reply that is not broadcast probably does not move `latest` (unverified), and an old root is never in a "since cursor" page anyway.

**Failure.** The user is away for a weekend. On Monday a long-running thread in a channel they do not follow it in gets ten replies, and Juno never shows it.

**Change.**
- Answer open question 1 (all active threads, or only followed ones) before M3. It changes boot cost, the data model and the reconnect logic.
- If the answer is "all threads", spike `search.modules.messages` with `is:thread after:<date>` as a discovery source. It is one paged call instead of 30 to 150 history calls, and it covers old roots. Check it against the live smoke first.
- Measure whether `counts.latest` moves on non-broadcast replies.
- Show a quiet "tracking since <date>" note in All topics so the gap is honest.

### 6. Live snapshots of big lists will be slow, and there is no virtualization plan

**Problem.** Every change to a topic re-runs `messages.list` and sends the whole page. The contract layer Schema-encodes it in the engine and Schema-decodes it in the renderer, which creates new objects every time, so `React.memo` never hits. The architecture never mentions virtualization, "stick to bottom", prepending older pages, or variable row heights.

**Failure.** A busy `#incidents` Main gets three bot messages a second, with blocks and reactions. Each one re-renders 200 rows, and the sidebar does the same.

**Reactivity details, checked in the 4.0.3 source.** The query runner offers results to an unbounded queue. A single failed run fails the queue, which ends the subscription for good. There is no debounce. Invalidation inside a transaction re-runs queries unless it is wrapped in `withBatch`. `@effect/sql-sqlite-node` uses one connection behind `Semaphore(1)`, so a 2,000-row backfill transaction blocks every live query and every command, including Resolve.

**Change.**
- Subscriptions cover a window (an anchor plus N rows) and never a full history.
- Give each row a `rev`, and keep a renderer-side cache by id so rows whose `rev` is unchanged keep the same object identity.
- Debounce with a leading edge, so a user command is not delayed by 30 ms.
- Catch errors in each query run and emit them as a value.
- Wrap store transactions in `Reactivity.withBatch`. Cap backfill transactions at about 200 rows.
- Decide on list rendering in M4. My suggestion: start with `content-visibility: auto` and a capped window, which keeps text selection, selection Quote and ⌘F working. Move to `react-virtuoso` only if measurements demand it.
- Set a budget, for example under 16 ms from invalidation to paint for 300 rows, and add an engine benchmark for it.

### 7. "No optimistic updates" must not apply to the composer, and undo should come from the engine

**Problem.** Drafts are a store table that the renderer reads through a live query, and `drafts.set` is a command.

**Failure.** If the composer value comes from the store, every keystroke makes a round trip through the port, the debounce and a re-render. The cursor jumps and characters drop.

**Change.**
- Composer text is local React state (or an uncontrolled field). It reads the draft once when it mounts and saves with a 500 ms debounce, fire and forget, never reading back while focused.
- Undo: a static table of inverse routes is wrong for compound commands. Resolve also marks the topic read and clears Reopened, and `reopen` restores neither. Let each command return `{ undo?: Command }`, computed inside the engine transaction from the prior state. The renderer only stores and replays it, which keeps the renderer dumb.

### 8. ADR 0002 rests on a weak premise, and engine restarts are not designed

**Problem.** `effect/rpc` 4.0.3 does have postMessage transports: `RpcClient.layerProtocolWorker` and `RpcServer.layerProtocolWorkerRunner`. They sit on `WorkerPlatform.makePlatform`, which takes any object with `postMessage`. `effect/reactivity/AtomRpc` also connects RPC clients to atoms, with reactivity keys. The ADR rejects rpc for being unstable, yet the same design already depends on `sql`, `Reactivity` and `Atom`, which are all marked `@stability unstable`.

**Failure.**
- The custom protocol has to rebuild request ids, interruption, error and defect encoding, back-pressure, multiple clients and reconnects. "About 150 lines each" is optimistic.
- Section 2.3 says the renderer learns about a restart through `engine.status`, but that subscription runs over the port that just died.

**Change.**
- Spend one day on a spike: `RpcGroup` in `contract`, adapters for `MessagePort` and `MessagePortMain`, and `AtomRpc` in `state`. If it works, use it and delete the hand-written protocol. If not, keep ADR 0002 but write down the missing parts.
- Either way, the renderer watches the port's `close` event (verified: a renderer `MessagePort` fires `close` when the utility process dies) and then asks main for a new port.
- The engine accepts several ports at once (renderer reload, a second window) and cleans up their subscriptions when a port closes.
- Main restarts the engine with backoff and a cap on crash loops.

### 9. Fourteen packages is too many, and the engine is split by layer instead of by feature

**Problem.** `store`, `sync`, `notifications`, `assistant`, `ai` and `engine` share one database, one transaction and one process. One feature, such as resolve, touches `domain`, `store`, `sync`, `engine`, `contract`, `state`, `views` and `desktop`. `store` turns into a large query API that four packages call. Every new edge needs `check-deps` and `package.json` edits.

**Failure.** Cross-package churn, early API freezes between modules that change together, and more merge conflicts for agents working in parallel, not fewer.

**Change.** Keep the boundaries that protect a rule:

| Package | Rule it protects |
| --- | --- |
| `domain` | Pure: no I/O |
| `contract` | The wire shared by both sides |
| `slack` | The client, shared with `fake-slack` |
| `fake-slack` | Test server, cannot import the engine |
| `engine` | Business logic and I/O |
| `tokens`, `ui`, `views` | Dumb UI, cannot reach logic |
| `state` | The bridge from the engine to React |

Inside `engine`, use feature folders (`topics/`, `messages/`, `reads/`, `notifications/`, `assistant/`, `sync/`, `store/`). Each folder owns its own queries. Enforce the folder boundaries with a lint rule (oxlint `overrides` with `no-restricted-imports`, or dependency-cruiser). The `ai` provider can be a folder too. Split a folder into a package only when a second consumer appears.

### 10. Split the database into a disposable cache and durable user data, one set per workspace

**Problem.** One file holds the Slack mirror, the derived index and data that cannot be rebuilt: overlay, rules, outbox, drafts and prefs. The document says tables are "keyed by `team_id` from day one", but the schema it shows has no `team_id` outside `topic_index`.

**Failure.**
- Every change to the mirror schema needs a careful migration.
- If the mirror drifts, there is no safe "reset".
- Adding multi-workspace support later means touching every query.

**Change.** Use `cache.db` for the mirror, `topic_index`, FTS and `ai_cache`. It can be dropped and re-synced whenever its schema version changes. Use `user.db` for the overlay, rules, outbox, drafts and prefs, with real migrations. Join them with `ATTACH`. Use one directory per workspace (or Grid org) instead of `team_id` columns. Add a "Reset local cache" action.

### 11. `topic_index` will drift unless there is exactly one way to compute it

**Problem.** It is a denormalised table that many write paths update incrementally.

**Failure.** Counts and previews slowly diverge from the messages, for example a count that never drops back to zero.

**Change.**
- Use one function, `reindexTopics(ids)`, that recomputes rows from source tables. Call it at the end of each transaction for the topics that transaction touched. Never use arithmetic like `unread_count + 1`.
- Add an engine test that compares the incremental index with a full rebuild after random event sequences.
- Changes that depend only on time (a topic turning quiet after N days, digest slots) need a clock-driven invalidation, because no write will trigger them.

### 12. Rate-limit handling will stall interactive use

**Problem.** A 60 s base backoff with three retries applies to every lane, and the limits are tracked per call, not per method. Cold boot for a manager in 150 active channels is roughly 150 history calls plus 50 reply calls, which takes about 5 minutes at 40 calls a minute. The spec has no state for that.

**Failure.**
- Opening a topic during a 429 freezes the spinner for a minute.
- Three interactive calls hit a bucket that is already known to be limited.

**Change.**
- Keep a per-method bucket that pauses on `Retry-After`.
- On the interactive lane, show cached data and retry quietly instead of blocking.
- Report boot progress in `engine.status` and design a "catching up" state.

### 13. Enterprise Grid is treated as later, but it may be now

**Problem.** Grid needs `enterprise_api_token` for org-scoped methods, `slack_route=E:T`, org-wide threads (`update_global_thread_state`), shared channels with users from other teams, and a different permalink host.

**Change.** Check today whether the owner's `localConfig_v2` has an `enterprise_id`. If it does, Grid belongs in M2 and M3, and `fake-slack` needs a Grid mode.

### 14. Testing gaps

- **OS notifications.** These are untested. In `JUNO_E2E` mode, main uses a recording `Notifier`, and tests read it with `app.evaluate`. A notification click is simulated the same way.
- **Clocks.** `JUNO_CLOCK` has no control path, and the renderer's `now` uses a different clock from the engine's. Send `clock.advance` from e2e through main to the engine's parentPort. The renderer gets `now` ticks from the engine, so there is one clock.
- **Native menus.** Instead of a renderer `debug` hook, keep the last built menu in main and click items by id through `app.evaluate`. That tests the real template code, and it adds nothing to the renderer bridge in production.
- **Import from the Slack app.** This is untestable as written. Add a seam: a fixture leveldb, a fixture `Cookies` file and an injected keychain password.
- **`safeStorage`.** Under e2e, use a plaintext secrets store so the keychain cannot prompt or flake.
- **Fake drift.** `fake-slack` encodes with the client's own schemas, so a wrong schema passes on both sides. Save redacted real payloads from the live smoke and replay them in engine tests.
- **Speed.** The scaffold uses `workers: 1`. Each test already gets its own data dir and can get its own fake port, so run four workers.
- **Gallery baselines.** Font rendering differs between macOS versions. Generate and compare baselines on one CI image, or treat diffs as review aids rather than a gate.

### 15. Spec items the architecture does not cover

- **Message rendering.** Converting `blocks`, `rich_text`, mrkdwn, attachments, bot messages and files into `MessageView`, and the composer's text with @ and # mentions into `rich_text` blocks. This is a large, well-testable `domain` module with no owner and no milestone.
- **Emoji.** The picker and reactions need the standard set plus custom emoji (edge `emojis/list`). There is no table and no source.
- **New DMs.** "Message Maya Chen" with no existing DM needs `conversations.open`. It is missing from the outbox kinds.
- **App menu bar and shortcuts.** ⌘Z, ⌘K and ⌘J should be app-menu items that send commands to the renderer. That feels native, and it settles which handler gets ⌘Z, the Edit menu or the renderer, which needs testing either way.
- **States.** First run, catching up, offline and session-expired states are not designed.
- **Double notifications.** While the official app runs, the user gets its notifications and Juno's. Onboarding should say so.
- **Notification dedupe.** `desktop_notification` and local mention detection both fire for the same message. Put a unique key on `notification_log (channel, ts)`.
- **Local search.** It needs an FTS5 table fed by the message write path. FTS5 is available in Electron 44's `node:sqlite` (verified). Decide in M4, not M9.
- **AI cost per message.** The settled check and grouping run on every new message. Debounce per topic, for example scoring once the topic has been idle for 2 minutes.
- **Sign-out.** It should also delete the message cache, not only the secrets.

### 16. Agents will collide and will write Effect 3 code

**Problem.**
- There is no `AGENTS.md` or `CLAUDE.md`.
- Effect 4 renamed core APIs. 4.0.3 has no `Context.Tag` and no `Effect.catchAll`, and agents trained on v3 will reach for both.
- Conflict hotspots: single route tables, sequential migration numbers, the engine wiring file and the `check-deps` table.
- "View fixtures double as fake-slack seeds" couples UI edits to e2e data, and the shapes do not overlap anyway: view models on one side, Slack payloads on the other.

**Change.**
- Add an `AGENTS.md`. It should say where code goes, cover the layer rules and the verify commands (typecheck, lint, deps, engine tests, one e2e file), and point to `node_modules/effect/ai-docs`, which exists in 4.0.3.
- Use one route file and one engine handler file per feature area.
- Give migrations timestamp ids (`202610121430_add_x`).
- Keep view fixtures and fake-slack seeds separate.

## Smaller notes

- **The utility process is the right call.** Keep it. Its only real cost is the restart and reconnect design in finding 8.
- **The custom `juno://` scheme is justified and cheap**, at about 30 lines. It gives a real origin, a meaningful CSP `'self'`, and the `juno://files` route. The scaffold still uses `loadFile`, so switch in M1. It must be registered as `standard` and `secure` before ready, so relative StyleX CSS and font URLs resolve. Add an e2e check of `location.protocol`.
- **CSP drift.** The scaffold's production CSP allows `style-src 'unsafe-inline'`, but section 12 says `'self'` only. React and StyleX set dynamic styles through the CSSOM, which CSP allows, so the stricter policy should hold. Test it and align the two.
- **Port handshake.** The renderer gets the port through `window.postMessage` from the preload, not as a bridge return value. Check `event.source === window`. The spike confirmed this pattern works with `sandbox` and `contextIsolation`.
- **`Stream.retry` (stable)** retries every error. Turn `invalid_auth` and `user_session_expiration` into a separate fatal path before the retry, for example by ending the stream with them as values. Otherwise the schedule retries them too.
- **Decode failures.** A frame of a known type with an unexpected shape must be logged and skipped, never treated as a stream error. Keep a small ring buffer of raw failing payloads (redacted) for debugging drift.

## API verification

| Claim | Status |
| --- | --- |
| `Schema.TaggedError` | Exists in `effect@4.0.3` `Schema.ts` |
| `Reactivity` | `effect/reactivity/Reactivity`, unstable. Has `query`, `stream`, `invalidate`, `withBatch`. `SqlClient` has `reactive` and `reactiveMailbox` |
| `Stream.retry(schedule)` | Exists, stable. The schedule resets after the first new element |
| `effect/reactivity/Atom` | Resolves through the `./*` export. Unstable. The scaffold already uses it |
| `effect/rpc` over postMessage | `RpcClient.layerProtocolWorker` and `RpcServer.layerProtocolWorkerRunner` exist, plus `AtomRpc` |
| `@effect/sql-sqlite-node@4.0.3` | On npm, peer `effect ^4.0.3`, uses `node:sqlite` `DatabaseSync`, one serialized connection, WAL, a 5 s busy timeout that blocks the event loop. Not installed yet |
| `node:sqlite` in Electron 44 | Node 24.21.0, SQLite 3.53.4, FTS5 and JSON functions work (run) |
| `ws` with headers | `ws` 8.22.0 supports a `headers` option. Not installed yet |
| `utilityProcess` + `MessageChannelMain` to a sandboxed renderer | Works (run). The renderer port fires `close` when the engine is killed |
| `net` in the utility process | Works with `partition`. It sends session cookies and stores `Set-Cookie` (run) |
| Effect v3 names | `Context.Tag` and `Effect.catchAll` do not exist in 4.0.3. Use `Context.Service`, `Effect.catch` and `catchTag` |
