# 0002. A small Schema-typed message protocol instead of effect/rpc

Status: superseded by ADR 0009 (2026-10-12), whose spike chose `effect/rpc`. Kept as the record of the fallback design; it was not implemented.

## Context

The renderer needs typed queries, live subscriptions, commands and errors from the engine. Effect 4 ships `effect/rpc`, which offers exactly that, but it is tagged `@stability unstable`. At the time of writing we believed it had no Electron or MessagePort transport. The review showed that `RpcClient.layerProtocolWorker` and `RpcServer.layerProtocolWorkerRunner` exist and sit on `Worker.makePlatform`, which accepts any object with `postMessage`, and that `AtomRpc.Service` binds an `RpcGroup` to atoms. The premise of this ADR was therefore too weak to decide on; ADR 0009 replaces it with a time-boxed spike.

## Decision (fallback)

If the spike rejects `effect/rpc`: `@juno/contract` defines eight wire messages as Effect `Schema` structs: `req`, `ok`, `err`, `sub`, `next`, `end`, `unsub`, `evt`. Routes are declared in per-feature tables with `payload`, `success`, `error` schemas and a kind (`query`, `live`, `command`, `event`). `@juno/state` implements the client and `@juno/engine` the server. Live queries emit a first snapshot and then deltas; errors are `Schema.TaggedError` classes; decode failures become `ProtocolError`.

## Consequences

- We own the protocol and can read it in devtools.
- Known gaps to write down if this path is taken: back-pressure, defect encoding, multiple clients, and reconnect after an engine restart.
- The route declarations are shared with the `effect/rpc` path, so the choice only changes two transport files.
