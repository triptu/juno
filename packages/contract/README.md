# @juno/contract

The wire between Juno's processes. Names, schemas and types only; no logic. See `docs/architecture.md` sections 2.4 and 2.6.

## What it holds

| File | Contents |
| --- | --- |
| `src/live.ts` | `liveValueRoute`, `liveListRoute`, `ListRange`, `LiveMeta`, `ListDelta`, the size budgets |
| `src/routes/<feature>.ts` | One `RpcGroup` per feature (`EngineRoutes` today). `routes/index.ts` merges them into `AllRoutes` |
| `src/errors.ts` | The errors a route may fail with: `NotSignedIn`, `Offline`, `Rejected`, `RateLimited`, `NotFound`, `AiUnavailable`, `Invalid`, `ProtocolError` |
| `src/shell.ts` | `ShellRoutes`, `ShellInput`, `ShellOutput`: renderer to main requests; `Theme`, `AppInfo` |
| `src/channels.ts` | Channel names and the `window.juno` bridge type. No runtime imports, because the preload bundles it |
| `src/protocol.ts` | `parentPort` messages (`MainToEngine`, `EngineToMain`), `EngineConfig` and the port handoff |

## Public API

- Declare a stream route with `liveValueRoute(tag, { value, payload? })` or `liveListRoute(tag, { row, payload? })`. The list route adds `range: ListRange` to the payload, and rows carry `id` and `rev`.
- Declare a command with `Rpc.make(tag, { payload, success, error })`.
- Import from `@juno/contract`. The preload imports only `@juno/contract/channels`.

## Must not

- Contain logic, I/O or React. It is schemas and types.
- Import anything but `effect`, and `@juno/domain` for shared view model types.
- Add a runtime import to `channels.ts`.
- Let a route fail with a `@juno/slack` or `@juno/store` error. The engine maps them to the errors here (architecture 2.6, "Error mapping").

## Testing

No tests of its own. The routes are exercised by `packages/engine/test` (the real client against the real server over a `MessageChannel`) and by `apps/desktop/e2e`.
