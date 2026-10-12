# @juno/engine

The engine: all of Juno's business logic and I/O, as Effect services in one Node program. It runs in Electron's utility process and, for tests, under plain Node. See `docs/architecture.md` sections 1, 2.5 and 2.6.

## What it owns

- `startEngine(transport, config)`: builds the app layer, serves the RPC protocol, returns `{ stop }`. Services and the server come up before any boot work, so the first live query is answered from local state.
- The protocol (`src/protocol`): the `RpcServer` over a worker-runner platform that accepts every port a `Transport` hands it, and the serve helpers.
- Feature folders (`src/<feature>/`), each with its route handlers and services. `src/status/` is the worked example.
- `src/layer.ts`: the one place that merges feature `Services` and `Handlers`.

## Public API

- `startEngine`, `EngineHandle`.
- `electronTransport`, `memoryTransport`, `Transport`, `EnginePort`: where ports come from.
- `serveLiveValue(runs, options)`, `serveLiveList(runs, { encodeRow })`, `timed(query)`: turn a stream of query runs into `meta`-stamped messages and row deltas. Feed them `liveQuery(keys, timed(query))` from `@juno/store`.

## Must not

- Import `electron`, React, `@juno/state` (except in tests) or `@juno/views`. The host adapts Electron ports to `Transport`.
- Let one feature folder import another, or `layer`, `startEngine` or `index` (`check-deps` enforces it).
- Import `effect/sql`, `effect/reactivity` or other unstable modules outside `src/protocol`. Reach the database through `@juno/store`.
- Hold domain rules. Those belong in `@juno/domain`.
- Let a `@juno/slack` or `@juno/store` error reach a route unmapped (architecture 2.6, "Error mapping").

## Testing

`pnpm --filter @juno/engine test`. The tests start the real engine on a `memoryTransport` and talk to it with the real `@juno/state` client over a Node `MessageChannel`, so they cover the wire end to end. `test/live.test.ts` covers the serve helpers: a burst collapses into two runs, and a failed run keeps the subscription alive with `meta.error`.
