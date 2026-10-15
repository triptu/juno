import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The built-in Automated view (SPEC section 5, "Automated").
 *
 * `automated_channels`: conversations whose place is settled, one row each.
 * `verdict` is `automated` (in the view), `kept` (stays where it is) or
 * `ask` (Home asks the user). `by` is who settled it: `rules`, `juno` or
 * `you`. A row by `you` is never changed by the rules or by Juno.
 *
 * `builtin_views`: built-in views Juno has made once. A view listed here
 * that is not in `sidebar_views` was deleted by the user, and Juno does not
 * make it again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE automated_channels (
    channel TEXT PRIMARY KEY,
    verdict TEXT NOT NULL CHECK (verdict IN ('automated', 'kept', 'ask')),
    by TEXT NOT NULL CHECK (by IN ('rules', 'juno', 'you')),
    at TEXT NOT NULL
  ) WITHOUT ROWID`
  yield* sql`CREATE TABLE builtin_views (
    id TEXT PRIMARY KEY,
    made_at TEXT NOT NULL
  ) WITHOUT ROWID`
})
