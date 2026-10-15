import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * Sidebar views (SPEC section 5, "Views"): pills in the filter row, each a
 * set of channels and DMs the user picked. Local to Juno.
 *
 * `sidebar_views`: one row per view, `position` its place in the pill row,
 * `keep_out_of_all` the "Keep these out of All" setting.
 *
 * `sidebar_view_channels`: a view's conversations. The channel index serves
 * the sidebar's "kept out of All" set and Add to view's checks.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE sidebar_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    position INTEGER NOT NULL,
    keep_out_of_all INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`
  yield* sql`CREATE TABLE sidebar_view_channels (
    view_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    added_at TEXT NOT NULL,
    PRIMARY KEY (view_id, channel)
  ) WITHOUT ROWID`
  yield* sql`CREATE INDEX sidebar_view_channels_channel ON sidebar_view_channels (channel, view_id)`
})
