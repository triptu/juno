# @juno/contract

The wire between Juno's processes. Names, schemas and types only; no logic. See `docs/architecture.md` sections 2.4 and 2.6.

## What it holds

| File | Contents |
| --- | --- |
| `src/live.ts` | `liveValueRoute`, `liveListRoute`, `ListRange`, `LiveMeta`, `ListDelta` (with its optional `refs`), the size budgets |
| `src/refs.ts` | The side tables list routes send next to their rows: `Person`, `ChannelRef`, `TopicArt` (a topic's recipe; an empty recipe means not shown), `Refs` (architecture 7) |
| `src/body.ts` | `MessageBody` as a schema: the body `@juno/richtext` builds, checked against richtext's type at compile time in `engine/src/messages/body.ts` |
| `src/routes/<feature>.ts` | One `RpcGroup` per feature (`EngineRoutes`, `SessionRoutes`, `TopicsRoutes`, `AllTopicsRoutes`, `MessagesRoutes`, `ArtRoutes` with `art.redraw` and its undo `art.restore`). `routes/index.ts` merges them into `AllRoutes` |
| `src/errors.ts` | The errors a route may fail with: `NotSignedIn`, `Offline`, `Rejected`, `RateLimited`, `NotFound`, `AiUnavailable`, `Invalid`, `ProtocolError` |
| `src/shell.ts` | `ShellRoutes`, `ShellInput`, `ShellOutput`: renderer to main requests (app info, the engine port, launch theme and accent, `contextMenu.popup`, `shell.openExternal`); `Theme`, `AppInfo` |
| `src/channels.ts` | Channel names, the `window.juno` bridge type, `ContextMenuItem`, and the main-to-renderer `menu.command` event with its `MenuCommand` (`tab.close`, `tab.next`, `tab.previous`). No runtime imports, because the preload bundles it |
| `src/protocol.ts` | `parentPort` messages (`MainToEngine`, `EngineToMain`), `EngineConfig` and the port handoff |

## Public API

- Declare a stream route with `liveValueRoute(tag, { value, payload? })` or `liveListRoute(tag, { row, payload? })`. The list route adds `range: ListRange` to the payload, and rows carry `id` and `rev`.
- Declare a command with `Rpc.make(tag, { payload, success, error })`.
- Import from `@juno/contract`. The preload imports only `@juno/contract/channels`.
- `routes/messages.ts` is the topic view: `messages.list` (a window of `MessageView` rows around an anchor ts), `topics.get` (the header, `TopicDetail`), `channel.threads` (Main's active threads, `ThreadSummary`), and the two commands that call Slack, `topics.open` and `messages.loadOlder`. Rows name people by id; the people travel in the delta's `refs`.
- `topics.list` sends `TopicListRow`s, which name their channel and people by id; `TopicRow` is the joined row `@juno/state` builds for the views, with `RowChannel`, `Person` and `art` (the topic art recipe, from `refs.art`) filled in from the refs. `TopicDetail.art` carries the same recipe for the header. A Main row's `newThreads` is the number of threads started in the channel since Main was last read.
- `routes/allTopics.ts` is the All topics page: `allTopics.list` sends the same `TopicListRow`s, a window of `ALL_TOPICS_WINDOW` (200) rows at `offset` in the list sorted and filtered by `AllTopicsFilter` (status chip, kind, place, sort, text), with the whole list's length in `meta.total`; `allTopics.summary` is the chips' counts and the conversations the place select lists.
- `routes/topics.ts` re-exports the vocabulary `@juno/domain` owns (`TopicKind`, `ConversationKind`, `ContextTint`, `RowTag`, `ChannelIcon`, `ChannelColor`; `TopicStatus` is domain's `AllTopicsStatus`) and declares `SIDEBAR_WINDOW`, the 300-row cap the engine applies and the renderer asks for. `TopicPreview` is `{ sender, text }`; the view joins them.

## Must not

- Contain logic, I/O or React. It is schemas and types.
- Import anything but `effect`, and `@juno/domain` for shared view model types.
- Add a runtime import to `channels.ts`.
- Let a route fail with a `@juno/slack` or `@juno/store` error. The engine maps them to the errors here (architecture 2.6, "Error mapping").

## Testing

No tests of its own. The routes are exercised by `packages/engine/test` (the real client against the real server over a `MessageChannel`) and by `apps/desktop/e2e`.

## M4 local routes

- `search.query { query, limit? }` is a live value of at most 50 `SearchResult`s, each with what the ⌘K palette shows: a topic (title, place, last activity), a message (its topic's title, place, sender and plain text), a channel (and its Main when the store has one) or a person (and the Main of your DM). Channels and people come first, at most `SEARCH_PLACES_MAX` each, then titles, then messages; FTS ranks matches within each group. The last word is a prefix. An empty query returns recent topics. Ignored and non-member channels are excluded.
- `search.slack { query }` asks Slack's message search for what the cache lacks and returns `SearchMessage`s, `stored: false` for those the store does not hold. It stores nothing, and is empty when Slack cannot be reached.
- `search.command { text }` reads the palette's text as a `PaletteCommand` (send to a person, open a DM, post in a channel, ask Juno, resolve a topic), or `null`; always `null` while AI assist is off.
- `reads.markRead { id, upTo? }` and `reads.markUnread { id, from? }` change Juno's read pointer and return the undo (`UndoCommand` gains both); they fail only with `NotSignedIn` or `NotFound`, never because Slack could not be reached. `reads.mirror` is the live mirror setting `{ on, explicit }`; the preference behind it is `MIRROR_READS_PREF` (`reads.mirror`), written with `prefs.set`.
- `prefs.get { key }` is a live JSON value from the open workspace's user.db; an absent key returns null. `prefs.set { key, value }` writes one JSON value and invalidates prefs. It fails with `NotSignedIn` without an open workspace. WP5 uses the key `tabs`.

The shell update routes (`updates.get`, `updates.set`, `updates.restart`, `updates.download`, `updates.notes`), `UpdateState` and `ReleaseNotes` keep release handling, and the releases repository's token, in main. `updates.changed` forwards changes to the renderer.

- `mentions.emoji` serves cached workspace emoji and aliases once per workspace; composer keystrokes filter it locally. It never calls Slack.

Home's Recent, the `newChat.frequent` live query, returns up to five people then five channels, ranked by own sends over 30 days with a seven-day half-life, then filled by member activity. Archived and ignored channels are excluded. It never calls Slack. The renderer reads `frequentConversationsAtom` on page open without waiting to paint.

The ⌘K Conversations tab's `newChat.ranked` live query ranks the same way over own sends and topic visits (`topic_visits`), uncapped before its 12 rows, then by activity; with text it ranks the conversation picker's matches, names that start with the text first among the unused. It re-runs on conversation, user, ignore and visit changes, not on messages, so a send re-ranks it on the next open. The renderer reads it as `paletteConversationsAtom`.
