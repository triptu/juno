# @juno/engine

The engine: all of Juno's business logic and I/O, as Effect services in one Node program. It runs in Electron's utility process and, for tests, under plain Node. See `docs/architecture.md` sections 1, 2.5 and 2.6.

## What it owns

- `startEngine(transport, config, { host, httpTransport })`: builds the app layer, serves the RPC protocol, returns `{ stop }`. Services and the server come up before any boot work, so the first live query is answered from local state. `host` is the parentPort line to main (`memoryHost()` in tests); `httpTransport` is the Slack HTTP seam (`net.fetch` in the app, Node `fetch` by default).
- The protocol (`src/protocol`): the `RpcServer` over a worker-runner platform that accepts every port a `Transport` hands it, the serve helpers, and `HostLink` (`src/protocol/host.ts`), the service feature folders use to talk to main.
- Feature folders (`src/<feature>/`), each with its route handlers and services. `src/status/` is the worked example; `src/session/` owns the sign-in state, `auth.test`, sign-out, and `SyncRunner`, which runs `@juno/sync` inside the session's scope for every ready session; `src/topics/` serves `topics.list` and `topics.counts` from the open store and runs the `topics.subscribe` and `topics.unsubscribe` commands (`commands.ts`: one local transaction with a pending outbox row, the mirror to Slack, a root lookup after a failure or when Slack said something meanwhile, the undo in the result); `src/messages/` serves the topic view (`messages.list`, `topics.get`, `channel.threads`) and runs `topics.open` and `messages.loadOlder` (see "The topic view" below).
- `src/search/` serves `search.query` over local FTS indexes for titles, messages, channels and people; ignored and non-member channels are excluded before the limit. `src/prefs/` serves one durable JSON preference through `prefs.get` and `prefs.set`.
- `src/reads/`: `reads.markRead`, `reads.markUnread` and `reads.mirror` (`commands.ts`: one transaction that moves Juno's pointer, re-indexes the topic and writes or replaces the topic's `mark` outbox row; the undo in the result), the mirror setting (`setting.ts`: the `reads.mirror` preference, on by default only against the fake), and `MarkWorker` (`worker.ts`), which sends pending marks to Slack with coalescing, backoff and lookups (architecture 5.6, specs/readstate.qnt).
- `src/workspace.ts`: the `Workspace` service, the store of the signed-in team. The session opens it before any Slack call, so the first live query is answered from the cache; handlers follow `Workspace.changes`. A top-level module because the session, the runner and the handlers all need it and feature folders do not import each other.
- `src/sessionClient.ts`: the `SessionClient` service, the ready session's `SlackApi` as top-level modules see it. The session feature provides it (`src/session/client.ts`); `layer.ts` wires it. It exists so the outbox can reach Slack without importing the session feature.
- `src/outbox.ts`: the `Outbox` seam between a command's local change and Slack (architecture 5.7). Today `send` calls the method at once on the ready session's `send` lane and maps the client's errors to the contract's, `lookup` does the same on the interactive lane for an authoritative read after a change, and `exclusive(key)` runs commands on one target one at a time; the persisted outbox replaces this module later without changing the commands.
- `src/syncLink.ts`: the `SyncLink` service, what the topic view needs from the running sync: its `TopicFetcher` for opened topics (the session's `SyncRunner` hands it in while a sync runs) and the topics on screen (a `topics.get` subscription marks its topic), which the sync fetches again after a reconnect. Top-level for the same reason as `sessionClient.ts`.
- `src/topicRows.ts`: a `topic_index` row joined with its overlay, conversation and follow flag, and the glue to the domain's `Topic` and the wire's `ChannelRef` and `Person`. The sidebar query and the topic header shape topics through it.
- `src/layer.ts`: the one place that merges feature `Services` and `Handlers`, and folds the session status and the sync phase into `engine.status`.

## Public API

- `startEngine`, `EngineHandle`, `EngineHostOptions`.
- `Host`, `memoryHost`, `silentHost`, `HostLink`: the parentPort line to main and its test doubles.
- `electronTransport`, `memoryTransport`, `Transport`, `EnginePort`: where ports come from.
- `listTopics(filter, options, cache?)`, `makeRowCache()`, `SIDEBAR_WINDOW`: the sidebar query, for the live dry run (`scripts/sync-live-dry-run.ts`) and the benchmark.

Inside the engine, `src/protocol/live.ts` has the serve helpers feature handlers use: `serveLiveValue(runs, options)` and `serveLiveList(runs, { encodeRow })` turn a stream of query runs (`liveQuery(keys, timed(query))` from `@juno/store`) into `meta`-stamped messages and row deltas, and send nothing for a run that changed nothing; `retryFirstRun(label)` starts a served stream again with backoff when its first run fails, for a route with no error of its own to show.

`serveLiveList` also sends the side tables (`ListRun.refs`, architecture 7): a run returns every person and channel its rows name, and the helper sends one only when the subscription has not been sent it or it changed since.

## The sidebar query

`src/topics/query.ts`. Four indexed statements read the window; the pure rules in `@juno/domain` place, sort and shape the rows. Rows name their channel and people by id (`TopicListRow`); the run returns the channels and people as refs, so a new photo changes no row's `rev`. Each `topics.list` subscription keeps a `RowCache` per workspace: a topic whose joined columns and people did not change is not parsed or rebuilt, and its row object is reused; the users it has read are kept until the `users` table changes (the handler forgets them from a synchronous invalidation handler). Each subscription also re-runs once a minute by itself so a topic turns quiet on time. A failed run reaches the renderer as the last value with `meta.error`.

## The topic view

`src/messages/`. No live query calls Slack, so a prefetch is one local query.

- `messages.list` (`query.ts`, statements in `window.ts`): Main reads the partial index `messages_main` (roots and broadcast replies), a thread reads `messages_thread`; up to `before` rows older than the anchor, then the anchor and newer rows, `limit` in all (500 at most). Then the reactions by key and, for Main, the overlay titles of linked threads. Each subscription keeps a `MessageCache`: a message whose version, reactions, group start and thread link are unchanged keeps its row object; bodies are parsed with `@juno/richtext` from the names, channels and custom emoji the cache holds, and only the ids a body asked for that the cache lacked are read and that body parsed again. The cache drops those lookups when `users`, `conversations` or `emoji` change, which rebuilds every row once; `rev` is a hash of the shaped row, so a rebuilt row that looks the same does not travel. Senders are refs. Group starts come from `startsGroup`, thread link labels from `threadLinkLabel` (`@juno/domain`). Images get a `juno://files/<id>/<variant>?url=` thumbnail with the box the view reserves (at most 360 px on the long side).
- `topics.get` (`detail.ts`): the index row by key with the read pointer, or, for a topic the index does not hold yet, a header from the conversation alone, so an uncached topic opened offline still has a header. Main also counts its threads with activity in the quiet window.
- `channel.threads` (`detail.ts`): the channel's threads with activity in the quiet window through `topic_index_channel_activity`, newest first, with participants as refs.
- `topics.open` and `messages.loadOlder` (`handlers.ts`): the sync's `TopicFetcher` from `SyncLink`, on the interactive lane. Slack's answer comes back as `outcome` (`fetched`, `cached`, `offline`, `rate-limited`, `signed-out`, `rejected`), never as a failure; only an id that is not a topic fails, with `NotFound`.

## Must not

- Import `electron`, React, `@juno/state` (except in tests) or `@juno/views`. The host adapts Electron ports to `Transport`.
- Let one feature folder import another, or `layer`, `startEngine` or `index` (`check-deps` enforces it).
- Import `effect/sql`, `effect/reactivity` or other unstable modules outside `src/protocol`. Reach the database through `@juno/store`.
- Hold domain rules. Those belong in `@juno/domain`.
- Let a `@juno/slack` or `@juno/store` error reach a route unmapped (architecture 2.6, "Error mapping").

## Testing

`pnpm --filter @juno/engine test`. The tests start the real engine on a `memoryTransport` and talk to it with the real `@juno/state` client over a Node `MessageChannel` (`test/harness.ts`), so they cover the wire end to end.

- `test/live.test.ts`: the serve helpers, and recovery from SQL errors on a real store.
- `test/sync.test.ts`: boots against the fake, reads the sidebar rows and runs the subscribe commands. `test/convergence.test.ts` is the randomised sync test.
- `test/sidebar-rule.test.ts`: the sidebar and counts SQL against `sidebarPlacement` over a table of every topic status, and the two mention branches end to end.
- `test/sidebar-state.test.ts`: the renderer's sidebar atoms across filter changes and a profile change.
- `test/reads.test.ts`: the read commands against the fake: the calls each kind of topic makes, coalescing, retries and a restart with a pending mark, marks from other clients during and after a pending mark, the mirror setting, and that nothing marks by itself.
- `test/session.test.ts`: sign-in, sign-out and session expiry. `test/plan.test.ts` checks the query plans of the sidebar and the topic view.
- `test/messages.test.ts`: the topic view against the fake: the first and the incremental open of a thread (one replies call each), Main read from its synced range, an uncached topic opened offline, a prefetch with no Slack call, an older page, a live reply as one row in a small delta, an edit, a reaction and a deleted root as one row each, a thread link that follows its thread, a new photo as one ref with no row changed, image thumbnails, and Main's active threads.

Test files run one at a time with a 90 s test timeout, and the harness waits take at most 45 s (`WAIT_MS`), because cold boots slow each other down on a shared machine.

`JUNO_BENCH=1 pnpm --filter @juno/engine exec vitest run test/bench --silent=false` runs the large-seed benchmarks and prints the numbers with the load average: the query alone (with and without the row cache), `meta.queryMs` inside the engine while events land, the snapshot (rows and refs apart) and delta sizes, and the encode, clone and decode times. `messages-large.test.ts` does the same for a 300-message thread built like the M4 gate's fixture, and times opening it uncached and cached. Measured in October 2026 at a load of 4 to 8: `topics.list` 175 KB of rows and 92 KB of refs (was 321 KB of rows), query p95 2.5 ms; `messages.list` on 300 rows 167 KB of rows and under 1 KB of refs, a first run (every body parsed) 3.7 ms median and 5.3 ms p95, a re-run 0.8 ms median and 3.3 ms p95, 1.2 ms p95 inside the engine while replies land, deltas under 1 KB, encode and decode 0.9 ms; opening the uncached thread 0.68 s to the 300 rows (three replies pages from the fake), a new subscription to a cached window 18 ms to its first snapshot. Inside the engine the CPU is often idle between events, and the first run after an idle gap is about twice as slow as the same run on a busy CPU, so read both numbers.
`JUNO_SEARCH_BENCH=1 pnpm test --silent=false` runs the WP2 FTS gate through the root machine lock: 100 k stored messages and about 5 k topic titles, with 200-row backfill batches committing while search runs. It asserts p95 at most 20 ms and reports the sample range, row counts and load average. `JUNO_SEARCH_PROFILE=1` also prints each statement's query plan and writes `juno-wp2-search.cpuprofile` to the system temp directory.
