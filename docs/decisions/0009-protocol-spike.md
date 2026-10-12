# 0009. Decide the port protocol with a one-day spike: effect/rpc over MessagePort versus the custom protocol

Status: accepted, 2026-10-12. Supersedes ADR 0002.

## Context

ADR 0002 rejected `effect/rpc` for being unstable and lacking an Electron transport. The review checked `effect@4.0.3` and found `RpcClient.layerProtocolWorker` and `RpcServer.layerProtocolWorkerRunner`, built on `Worker.makePlatform`, which takes any object with `postMessage` (so a DOM `MessagePort` or a `MessagePortMain` can be adapted), plus `AtomRpc.Service`, which binds an `RpcGroup` to atoms with reactivity keys. The stability argument also cuts both ways: the design already depends on `sql`, `Reactivity` and `Atom`, all unstable. And "about 150 lines each" for a custom protocol does not cover request ids, interruption, error and defect encoding, back-pressure, multiple clients and reconnects.

## Decision

The first M1 task is a time-boxed (one day) spike with two branches that share the same route declarations in `@juno/contract` (per-feature groups with `payload`, `success`, `error`; stream routes for live queries; commands returning `{ undo?: Command }`).

- A: `RpcGroup` in `contract`, `Worker.makePlatform` adapters for `MessagePort` and `MessagePortMain`, `AtomRpc` in `state`.
- B: the eight-message custom protocol from ADR 0002.

Criteria, in order: (1) a live query and a streaming subscription work end to end from a sandboxed renderer to the utility process; (2) `unsub` and port close interrupt the engine fiber within 100 ms; (3) typed errors and defects arrive as values, never as a dead port; (4) several ports at once; (5) encode and decode of a 300-row snapshot under 5 ms per side; (6) owned lines of code and readability of a failure in devtools. A wins if it passes 1 to 4 and is within a factor of two of B on 5. Otherwise B is kept and its gaps (back-pressure, defect encoding, multi-client, reconnect) are written down as known.

Independent of the outcome: the renderer watches the port's `close` event and asks main for a new port; the engine accepts several ports; main restarts the engine with backoff and a crash-loop cap; live queries emit deltas with row revisions.

## Consequences

- One day of M1 is spent before the transport is fixed; everything else in M1 proceeds in parallel because the route declarations do not depend on the outcome.
- If A wins, we accept API churn in `effect/rpc` minor releases, pinned exactly, in exchange for not owning a protocol.
- If B wins, the custom protocol's gaps are explicit and tracked.
