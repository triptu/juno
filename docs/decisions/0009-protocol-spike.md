# 0009. Port protocol: `effect/rpc` over MessagePort, decided by a spike

Status: accepted, 2026-10-12. Supersedes ADR 0002. Spike run and decided the same day.

## Context

ADR 0002 rejected `effect/rpc` for being unstable and lacking an Electron transport. The review checked `effect@4.0.3` and found `RpcClient.layerProtocolWorker` and `RpcServer.layerProtocolWorkerRunner`, built on `Worker.makePlatform`, which takes any object with `postMessage` (so a DOM `MessagePort` or a `MessagePortMain` can be adapted), plus `AtomRpc.Service`, which binds an `RpcGroup` to atoms with reactivity keys. The stability argument also cuts both ways: the design already depends on `sql`, `Reactivity` and `Atom`, all unstable. And "about 150 lines each" for a custom protocol does not cover request ids, interruption, error and defect encoding, back-pressure, multiple clients and reconnects.

## The spike

Two branches shared one set of route declarations (`Rpc.make` with `payload`, `success`, `error`, `stream: true` for live queries) and the same MessagePort-shaped transport (Node `worker_threads` `MessageChannel`, which has the same `postMessage`, message and close surface as a DOM `MessagePort` and a `MessagePortMain`).

- A: `effect/rpc`. The engine side is a `WorkerRunnerPlatform` that accepts any number of ports (46 lines). The renderer side is a `Worker.makePlatform` adapter whose single "worker" is the current port, re-acquired after a close (28 lines). Everything else is the library: request ids, `Interrupt` on stream scope close, `Exit` encoding with `Fail`, `Die` and `Interrupt`, acks, client ids and the disconnect queue.
- B: the eight-message protocol from ADR 0002 (`req`, `ok`, `err`, `sub`, `next`, `end`, `unsub`, `evt`), a server of 54 lines and a client of 85 lines plus 34 lines of message schemas, with codecs read from the same `Rpc` objects.

Measured on an M-series Mac with Node 26, one process, both ends in memory:

| Criterion | A: effect/rpc | B: custom | Pass rule |
| --- | --- | --- | --- |
| 1. Command round trip | 4.8 ms first call (codec build), under 1 ms after | 1.2 ms first call | works |
| 1. Live query: snapshot then updates | 3 values `[0, 1, 2]` received | same | works |
| 2. Unsubscribe reaches the engine finalizer | 0.26 ms | 0.27 ms | under 100 ms |
| 2. Port close interrupts the engine fiber | 1.0 ms | 0.32 ms | under 100 ms |
| 3. `Schema.TaggedError` arrives as a value | `NotFound(x)` in the `Exit` | same | yes |
| 3. Handler defect arrives as a value, client stays usable | `Die(Error: boom)`, next ping succeeds | same | yes, with `disableFatalDefects: true` |
| 4. Two ports at once; closing one leaves the other streaming | second client received all 50 updates | same | yes |
| Reconnect after port close | next request succeeds on a fresh port (pool retry, 1 s) | succeeds at once (explicit reopen) | yes |
| 5. 300-row snapshot (64.7 kB JSON), encode / decode | 0.32 ms / 0.61 ms | 0.55 ms / 0.79 ms | under 5 ms each side |
| 5. 300-row snapshot, handler emit to client receipt | 1.42 ms | 1.44 ms | under 5 ms |
| 6. Owned lines | 74 | 173 | |

Both use the same `Schema.toCodecJson` codecs and the same structured-clone transport, so criterion 5 is a tie. B is faster on the first call only because A compiles its exit schemas lazily per route. What B does not have after 173 lines: acks and back-pressure for streams, interruption annotated as a client abort, a decode failure that ends one request instead of throwing inside the port listener, concurrency limits, span propagation, and a reconnect of in-flight subscriptions.

Two things learned that the implementation relies on:

- A client made by `RpcClient.make` inside `Effect.provide(layer)` dies with that layer's scope. The protocol layer must be built in the scope that owns the client (an `Atom.runtime` in `@juno/state`).
- A defect in a handler is fatal for the whole client unless the server is started with `disableFatalDefects: true`; with it, the defect is the `Exit` of that one request.

## Decision

Use `effect/rpc` (A). `@juno/contract` declares routes with `Rpc.make` in one `RpcGroup` per feature; `@juno/engine` hosts `RpcServer` over a port-accepting `WorkerRunnerPlatform`; `@juno/state` hosts `RpcClient` over a `Worker.makePlatform` adapter for the renderer's `MessagePort` and exposes it only through `liveQuery(route)` and `command(route)`. The custom protocol is not kept.

Independent of the outcome: the renderer watches the port's `close` event and asks main for a new port; the engine accepts several ports; main restarts the engine with backoff and a crash-loop cap; live queries emit deltas with row revisions.

## Consequences

- We own two transport adapters of under 50 lines each instead of a protocol. Failures in devtools show as `RpcClientError` with a reason (`WorkerReceiveError: port closed`) or as the route's `Exit`.
- `effect/rpc` and `effect/workers` are unstable and pinned exactly. They are imported only in `@juno/engine/protocol` and `@juno/state` (client and transport files); a rename in a minor release touches those files only.
- The pool retry in `RpcClient.layerProtocolWorker` waits 1 s before re-spawning after a port close. That matches the supervisor's 1 s restart base and is acceptable; in-flight requests at the time of the close fail with `RpcClientError` and the atoms re-subscribe.
