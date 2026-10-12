# 0002. A small Schema-typed message protocol instead of effect/rpc

Status: proposed, 2026-10-12

## Context

The renderer needs typed queries, live subscriptions, commands and errors from the engine. Effect 4 ships `effect/rpc`, which offers exactly that, but it is tagged `@stability unstable`, has no Electron or MessagePort transport, and its wire format is internal. The research estimates a custom `Protocol` adapter at about 100 lines, on top of an API that may change in minor releases. The contract is the interface every package and every test depends on; it should not move when a dependency does.

## Decision

`@juno/contract` defines eight wire messages as Effect `Schema` structs: `req`, `ok`, `err`, `sub`, `next`, `end`, `unsub`, `evt`. Routes are declared in tables with `input`, `output`, `error` schemas and a kind (`query`, `live`, `command`, `event`); commands may name an inverse route for undo. `@juno/state` implements the client (request ids, subscription registry, decode on receipt) and `@juno/engine` the server (route lookup, decode, run as an Effect fiber per request, interrupt on `unsub`, encode). Each side is about 150 lines. Route declarations mirror the shape of `RpcGroup` so a future move to `effect/rpc` is mechanical if it stabilises.

Live queries are the default read path: a subscription emits the current snapshot immediately, then new snapshots when store invalidation keys change (debounced, de-duplicated). Errors are `Schema.TaggedError` classes shared by both sides; decode failures become `ProtocolError`.

## Consequences

- We own and can read the full protocol; debugging is a `console.log` of JSON messages.
- No streaming of large payloads is supported beyond snapshots; message lists are paged by the route, not streamed. AI text is folded into snapshots at ~50 ms.
- No cancellation for commands (they are short); streams cancel with `unsub`.
- If `effect/rpc` stabilises and gains a MessagePort transport, the route tables carry over and only the two ~150-line files change.
