# @juno/contract

The wire between Juno's processes. Names, schemas and types only; no logic. See `docs/architecture.md` sections 2.4 and 2.6.

## What it holds

| File | Contents |
| --- | --- |
| `src/live.ts` | `liveValueRoute`, `liveListRoute`, `ListRange`, `LiveMeta`, `ListDelta` (with its optional `refs`), the size budgets |
| `src/refs.ts` | The side tables list routes send next to their rows: `Person`, `ChannelRef`, `Refs` (architecture 7) |
| `src/body.ts` | `MessageBody` as a schema: the body `@juno/richtext` builds, checked against richtext's type at compile time in `engine/src/messages/body.ts` |
| `src/routes/<feature>.ts` | One `RpcGroup` per feature (`EngineRoutes`, `SessionRoutes`, `TopicsRoutes`, `MessagesRoutes`). `routes/index.ts` merges them into `AllRoutes` |
| `src/errors.ts` | The errors a route may fail with: `NotSignedIn`, `Offline`, `Rejected`, `RateLimited`, `NotFound`, `AiUnavailable`, `Invalid`, `ProtocolError` |
| `src/shell.ts` | `ShellRoutes`, `ShellInput`, `ShellOutput`: renderer to main requests; `Theme`, `AppInfo` |
| `src/channels.ts` | Channel names and the `window.juno` bridge type. No runtime imports, because the preload bundles it |
| `src/protocol.ts` | `parentPort` messages (`MainToEngine`, `EngineToMain`), `EngineConfig` and the port handoff |

## Public API

- Declare a stream route with `liveValueRoute(tag, { value, payload? })` or `liveListRoute(tag, { row, payload? })`. The list route adds `range: ListRange` to the payload, and rows carry `id` and `rev`.
- Declare a command with `Rpc.make(tag, { payload, success, error })`.
- Import from `@juno/contract`. The preload imports only `@juno/contract/channels`.
- `routes/messages.ts` is the topic view: `messages.list` (a window of `MessageView` rows around an anchor ts), `topics.get` (the header, `TopicDetail`), `channel.threads` (Main's active threads, `ThreadSummary`), and the two commands that call Slack, `topics.open` and `messages.loadOlder`. Rows name people by id; the people travel in the delta's `refs`.
- `routes/topics.ts` re-exports the vocabulary `@juno/domain` owns (`TopicKind`, `ConversationKind`, `ContextTint`, `RowTag`, `ChannelIcon`, `ChannelColor`; `TopicStatus` is domain's `AllTopicsStatus`) and declares `SIDEBAR_WINDOW`, the 300-row cap the engine applies and the renderer asks for. `TopicPreview` is `{ sender, text }`; the view joins them.

## Must not

- Contain logic, I/O or React. It is schemas and types.
- Import anything but `effect`, and `@juno/domain` for shared view model types.
- Add a runtime import to `channels.ts`.
- Let a route fail with a `@juno/slack` or `@juno/store` error. The engine maps them to the errors here (architecture 2.6, "Error mapping").

## Testing

No tests of its own. The routes are exercised by `packages/engine/test` (the real client against the real server over a `MessageChannel`) and by `apps/desktop/e2e`.
