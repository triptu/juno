# @juno/engine

The engine: all of Juno's business logic and I/O, as Effect services in one Node program. It runs in Electron's utility process and, for tests, under plain Node. See `docs/architecture.md` sections 1, 2.5 and 2.6.

## What it owns

- `startEngine(transport, config, { host, httpTransport })`: builds the app layer, serves the RPC protocol, returns `{ stop }`. Services and the server come up before any boot work, so the first live query is answered from local state. `host` is the parentPort line to main (`memoryHost()` in tests); `httpTransport` is the Slack HTTP seam (`net.fetch` in the app, Node `fetch` by default).
- The protocol (`src/protocol`): the `RpcServer` over a worker-runner platform that accepts every port a `Transport` hands it, the serve helpers, and `HostLink` (`src/protocol/host.ts`), the service feature folders use to talk to main.
- Feature folders (`src/<feature>/`), each with its route handlers and services. `src/status/` is the worked example; `src/session/` owns the sign-in state, `auth.test`, sign-out, and `SyncRunner`, which runs `@juno/sync` inside the session's scope for every ready session; `src/topics/` serves `topics.list` and `topics.counts` from the open store and runs the `topics.subscribe` and `topics.unsubscribe` commands (`commands.ts`: one local transaction, the mirror to Slack, the revert on failure, the undo in the result).
- `src/workspace.ts`: the `Workspace` service, the store of the signed-in team. The session opens it before any Slack call, so the first live query is answered from the cache; handlers follow `Workspace.changes`. A top-level module because the session, the runner and the handlers all need it and feature folders do not import each other.
- `src/outbox.ts`: the `Outbox` seam between a command's local change and Slack (architecture 5.7). Today `send` calls the method at once on the ready session's `send` lane and maps the client's errors to the contract's; the persisted outbox replaces this module later without changing the commands.
- `src/layer.ts`: the one place that merges feature `Services` and `Handlers`, and folds the session status and the sync phase into `engine.status`.

## Public API

- `startEngine`, `EngineHandle`, `EngineHostOptions`.
- `Host`, `memoryHost`, `silentHost`, `HostLink`: the parentPort line to main and its test doubles.
- `electronTransport`, `memoryTransport`, `Transport`, `EnginePort`: where ports come from.
- `listTopics(filter, options, cache?)`, `makeRowCache()`, `SIDEBAR_WINDOW`: the sidebar query, for the live dry run (`scripts/sync-live-dry-run.ts`) and the benchmark.

Inside the engine, `src/protocol/live.ts` has the serve helpers feature handlers use: `serveLiveValue(runs, options)` and `serveLiveList(runs, { encodeRow })` turn a stream of query runs (`liveQuery(keys, timed(query))` from `@juno/store`) into `meta`-stamped messages and row deltas, and send nothing for a run that changed nothing; `retryFirstRun(label)` starts a served stream again with backoff when its first run fails, for a route with no error of its own to show.

## The sidebar query

`src/topics/query.ts`. Four indexed statements read the window; the pure rules in `@juno/domain` place, sort and shape the rows. Each `topics.list` subscription keeps a `RowCache` per workspace: a topic whose joined columns and people did not change is not parsed or rebuilt, and its row object is reused; the users it has read are kept until the `users` table changes (the handler forgets them from a synchronous invalidation handler). Each subscription also re-runs once a minute by itself so a topic turns quiet on time. A failed run reaches the renderer as the last value with `meta.error`.

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
- `test/session.test.ts`: sign-in, sign-out and session expiry. `test/plan.test.ts` checks the sidebar query plans.

Test files run one at a time with a 90 s test timeout, and the harness waits take at most 45 s (`WAIT_MS`), because cold boots slow each other down on a shared machine.

`JUNO_BENCH=1 pnpm --filter @juno/engine exec vitest run test/bench --silent=false` runs the large-seed benchmark and prints the numbers with the load average: the query alone (with and without the row cache), `meta.queryMs` inside the engine while events land, the snapshot and delta sizes, and the encode, clone and decode times. Inside the engine the CPU is often idle between events, and the first run after an idle gap is about twice as slow as the same run on a busy CPU, so read both numbers.
