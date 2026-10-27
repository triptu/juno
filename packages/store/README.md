# @juno/store

The two SQLite databases of one workspace and how to read and write them. See `docs/architecture.md` sections 4.1 to 4.3 and ADR 0008.

- FTS indexes: `messages_fts`, `topic_titles_fts` (root text), `channels_fts` and `people_fts` in cache.db, and `overlay_titles_fts` (manual and AI titles) in user.db. Triggers keep them in the same transaction as their source rows.
- `cache.db`: the Slack mirror. Updates keep it: new migrations run on the existing file. It is deleted and rebuilt only when `CACHE_RESET_EPOCH` changes or SQLite cannot open or migrate the existing cache. Recovery keeps `user.db`, including preferences and the outbox.
- `user.db`: Juno's own state (overlay, reads, drafts and `draft_sync`, outbox, prefs). Durable; migrations are incremental and never edited once shipped.

The unused `topic_overlay.tracked` column remains from the initial migration. Reply tracking was removed on 10-14; no code reads or writes this column, and shipped migrations stay unchanged.

## Public API

- `Store.layer(workspacePaths(...))`: provides `StoreWriter`, `StoreReader`, `Invalidation`, `StorePaths` and `Store` for one workspace directory. Both clients are `SqlClient`s on one serialised connection each; the writer attaches `cache.db` so a transaction can span both files.
- `transaction(effect)`: a writer transaction that fires its invalidations once after commit and not at all on rollback. `inBatches(rows, write)` splits large writes (`BATCH_ROWS`).
- `liveQuery(keys, query)`: a `Stream` of `Result`s. It runs `query` now and again when its keys are invalidated, with a leading-edge debounce and a 30 ms trailing window. A failed run is a `Result.fail` and the stream continues. `invalidate(keys)` marks keys by hand.
- `CommandWrite` marks a command's writes in its Effect context. The invalidation loop gives each run a `QueryCause`: its `own` flag includes command writes coalesced before or during that read. No-op reads consume their cause without marking later changes. This is presentation metadata; debounce, transactions and sync rules are unchanged.
- `searchMessages`, `prefs`, `syncState`, `syncedRanges`, `keys`: queries and key helpers. `Store.resetCache` is "Reset local cache".
- `SqlClient` (type) and `SqlError`, re-exported so callers do not import `effect/sql`.
- Row types (`MessageRow`, `TopicIndexRow`, ...) and the migrations lists.

`usergroups` in cache.db holds the workspace's user groups (`id`, `handle`, `name`, `deleted`), so a group mention shows its handle.

To change a schema, add a timestamped migration file in `src/migrations/<db>/` and list it in that folder's `index.ts`. Its id must be later than every shipped id in that folder: the Migrator skips ids at or below the newest one it has recorded. `scripts/check-migration-order.mjs` (run by `bun run lint`) checks both folders against `origin/main` (or `main`): an id main does not have must be above main's largest, and no id may repeat. It names the id to renumber and the smallest safe one. Without git it checks only that ids are unique.

### Cache migrations

`cache.db` migrations run on a populated cache, the same way as `user.db`'s, so an update does not sync everything from Slack again (ADR 0008, note of 10-16). Each one:

- Is additive where it can be: a new table, a new column with a default, a new index. It keeps every existing row.
- Refills data derived from what is stored, locally. An FTS table or index fills from its source rows inside the migration (`202610140100_search`). Work too long for startup, such as `reindexAll` over every topic in `@juno/sync`, runs once in the background after the boot, never in the migration, and makes no Slack calls.
- Leaves data that only Slack has to be fetched lazily: the sync asks for the items that need it, on the background lane. It never blocks the first paint and never starts a cold boot.
- Runs once: the Migrator records it in the same transaction, so a crash leaves the migration either applied and recorded or not applied at all.

A change that cannot be migrated changes `CACHE_RESET_EPOCH` in `src/migrations/cache/index.ts`. That deletes every user's cache and syncs everything again, so it needs a decision fragment that says "cache reset epoch N" and why; `scripts/check-cache-epoch.mjs` (run by `bun run lint`) fails without one. Tests can open a store with the migrations of a later build through `Store.layer(paths, { cacheMigrations })`; the desktop e2e test of an update uses `cacheMigrationsWithProbe`.

The topic view's Main window reads the partial index `messages_main (channel, ts)` over roots and broadcast replies; a query uses it only when its WHERE clause repeats the index's condition. Invalidation keys in the record form may give a table an empty id list (`{ messages: [topicId], users: [] }`), which subscribes to the whole table.

Indexes the sidebar relies on (`docs/performance.md` section 6): `topic_index (last_activity_ts DESC)`, `topic_index (channel, last_activity_ts DESC)`, the partial `topic_index (last_activity_ts DESC) WHERE unread_count > 0`, and the partial `topic_overlay (pinned_at) WHERE pinned_at IS NOT NULL`. `thread_ranges` (the replies pages proved, `@juno/sync` `threadRanges.ts`), `thread_subs.updated_event_ts`, `observed_at` and `commanded`, and `topic_reads.last_server_event_ts`, `observed_at`, `slack_read_ts` and `commanded` are the sync's coverage and ordering columns (architecture 5.4 and 5.6). Pending read marks are `outbox` rows of kind `mark`, found by `outbox (kind, next_at)`.
## Must not

- Call Slack or AI, or shape data for the UI. The engine turns query results into view models.
- Import `@juno/contract`.
- Let `effect/reactivity/Reactivity` leak out of `src/invalidation.ts`.
- Run `VACUUM` on `cache.db` (the FTS table points at its rowids).

## Testing

`bun run --cwd packages/store test` (`bun test`). Tests open a real store on a private temporary directory (`test/helpers.ts`), so files run side by side; synchronous SQLite handles and files are never shared. `itEffect` from `@juno/testing/effect` runs on a `TestClock`, so tests advance the debounce with `TestClock.adjust(DEFAULT_LIVE_QUERY_DEBOUNCE)`. The app's SQLite is Electron 44's `node:sqlite` (Node 24, SQLite 3.53.4); the tests run on Bun's, made to behave the same by the preload in `packages/testing/src/preload.ts` (Homebrew's SQLite on macOS, booleans bound as integers), and `test/node-sqlite.test.ts` pins what the store relies on. The desktop e2e suite runs the store on Electron itself.

⌘K's Conversations ranking reads recent own sends through the partial `messages_sender_ts (user_id, ts, channel) WHERE deleted = 0` index.

`started_threads` in user.db maps a root sent from Home: its outbox ID and pending topic ID to its acknowledged Slack root timestamp. The mapping survives reconciliation and keeps pending replies and saved tab views addressable.

`topic_inputs` in cache.db marks the `topic_index` rows that are up to date with what `reindexTopics` (`@juno/sync`) reads, so a re-index of an unchanged topic stops after one read. Triggers on `messages`, `thread_ranges`, `synced_ranges`, `channel_reads`, `topic_index`, `users`, `usergroups` and `conversations` delete a topic's mark when one of its inputs changes; a changed name or a conversation's kind clears every mark. A new column that `reindexTopics` reads needs its trigger here.

`messages.attention` is a derived cache projection for the badge existence query. Sync derives it from unread rich-text bodies while reindexing. It is reused only for the same message content and mention context; a trigger clears it when content changes. It is not a Slack field.

`huddle_history` in user.db keeps recent room facts with local joined and seen marks. End and join evidence only accumulates; rereading Slack history never clears an acknowledgement.

`messages_search_date (ts DESC, channel) WHERE deleted = 0` supports chronological search without a positive FTS term. Search filter compilation stays in the engine.
