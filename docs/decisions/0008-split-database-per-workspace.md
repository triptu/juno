# 0008. Two databases per workspace: a disposable cache and durable user data, with a writer and a reader connection

Status: accepted, 2026-10-12. Refines ADRs 0003 and 0004.

## Context

v1 put the Slack mirror, the derived index and the data that cannot be rebuilt (overlay, rules, outbox, drafts, prefs) in one file, and claimed multi-team readiness through `team_id` columns that the schema did not actually have. One file means every mirror schema change needs a careful migration, there is no safe reset when the mirror drifts, and multi-workspace later touches every query. `@effect/sql-sqlite-node` also uses one serialised connection, so a backfill transaction would block every live query and command.

## Decision

- `<userData>/workspaces/<enterprise_id or team_id>/cache.db` holds the mirror, `topic_index`, `messages_fts`, `emoji`, `files` and `ai_cache`. It carries a schema version; on mismatch it is deleted and re-synced. Preferences offers "Reset local cache". Sign-out deletes it.
- `.../user.db` holds the overlay, reads, groups, ignored channels, notification data, For you cards, the Juno chat, drafts, outbox and prefs, with timestamped migrations.
- The writer connection attaches `cache.db` to `user.db`, so one transaction can touch both. A second, read-only connection in WAL mode serves live queries. Busy timeout is 250 ms with retry in Effect; backfill transactions are capped at 200 rows.
- One directory per workspace replaces `team_id` columns. The v1 UI opens one workspace.

## Consequences

- Mirror schema changes are a version bump and a re-sync, never a migration.
- A corrupted or drifted mirror is recoverable by the user in one click.
- Multi-workspace is a directory switch, not a query rewrite.
- Live queries and commands keep running during backfill; the engine benchmark checks the budget.
- Two connections and `ATTACH` mean the store module must be explicit about which client each query uses; the `StoreReader` and `StoreWriter` services make that a type, not a convention.
