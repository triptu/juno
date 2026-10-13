# @juno/store

The two SQLite databases of one workspace and how to read and write them. See `docs/architecture.md` sections 4.1 to 4.3 and ADR 0008.

- FTS indexes: `messages_fts`, `topic_titles_fts` (root text), `channels_fts` and `people_fts` in cache.db, and `overlay_titles_fts` (manual and AI titles) in user.db. Triggers keep them in the same transaction as their source rows.
- `cache.db`: the Slack mirror. Disposable; deleted and rebuilt when `CACHE_SCHEMA_VERSION` changes.
- `user.db`: Juno's own state (overlay, reads, outbox, prefs). Durable; migrations are incremental and never edited once shipped.

## Public API

- `Store.layer(workspacePaths(...))`: provides `StoreWriter`, `StoreReader`, `Invalidation`, `StorePaths` and `Store` for one workspace directory. Both clients are `SqlClient`s on one serialised connection each; the writer attaches `cache.db` so a transaction can span both files.
- `transaction(effect)`: a writer transaction that fires its invalidations once after commit and not at all on rollback. `inBatches(rows, write)` splits large writes (`BATCH_ROWS`).
- `liveQuery(keys, query)`: a `Stream` of `Result`s. It runs `query` now and again when its keys are invalidated, with a leading-edge debounce and a 30 ms trailing window. A failed run is a `Result.fail` and the stream continues. `invalidate(keys)` marks keys by hand.
- `searchMessages`, `prefs`, `syncState`, `syncedRanges`, `keys`: queries and key helpers. `Store.resetCache` is "Reset local cache".
- `SqlClient` (type) and `SqlError`, re-exported so callers do not import `effect/sql`.
- Row types (`MessageRow`, `TopicIndexRow`, ...) and the migrations lists.

To change a schema, add a timestamped migration file in `src/migrations/<db>/` and list it in that folder's `index.ts`. For `cache.db`, also bump `CACHE_SCHEMA_VERSION`.

The topic view's Main window reads the partial index `messages_main (channel, ts)` over roots and broadcast replies; a query uses it only when its WHERE clause repeats the index's condition. Invalidation keys in the record form may give a table an empty id list (`{ messages: [topicId], users: [] }`), which subscribes to the whole table.

Indexes the sidebar relies on (`docs/performance.md` section 6): `topic_index (last_activity_ts DESC)`, `topic_index (channel, last_activity_ts DESC)`, the partial `topic_index (last_activity_ts DESC) WHERE unread_count > 0`, and the partial `topic_overlay (pinned_at) WHERE pinned_at IS NOT NULL`. `thread_cursors.complete_from`, `thread_subs.updated_event_ts`, `observed_at` and `commanded`, and `topic_reads.last_server_event_ts` are the sync's coverage and ordering columns (architecture 5.4 and 5.6).

## Must not

- Call Slack or AI, or shape data for the UI. The engine turns query results into view models.
- Import `@juno/contract`.
- Let `effect/reactivity/Reactivity` leak out of `src/invalidation.ts`.
- Run `VACUUM` on `cache.db` (the FTS table points at its rowids).

## Testing

`pnpm --filter @juno/store test`. Tests open a real store on a temporary directory (`test/helpers.ts`) and use `@effect/vitest`. `it.effect` runs on a `TestClock`, so tests advance the debounce with `TestClock.adjust(DEFAULT_LIVE_QUERY_DEBOUNCE)`. SQLite is `node:sqlite`; Electron 44 runs Node 24, so see `docs/development.md` for running the suite under Electron's Node.
