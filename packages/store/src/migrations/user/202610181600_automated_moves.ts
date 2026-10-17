import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The record of what Juno did to the Automated view (SPEC section 12,
 * "Automated, with a record"): one row per conversation, its latest move.
 * `change` is `in` (Juno put it in Automated) or `out` (Juno took it back
 * out, because people start most conversations there). `by` is `rules` or
 * `juno`; the user's own moves are not recorded. `apps`, `people` (of
 * them `you`, the user's) and `sampled` are the counts of the latest top-level messages the rule read,
 * and `reason` is Juno's line when Juno decided. `seen_at` is when Home
 * first showed the move; a seen move is not shown again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS automated_moves (
    channel TEXT PRIMARY KEY,
    change TEXT NOT NULL CHECK (change IN ('in', 'out')),
    by TEXT NOT NULL CHECK (by IN ('rules', 'juno')),
    at TEXT NOT NULL,
    apps INTEGER,
    people INTEGER,
    you INTEGER,
    sampled INTEGER,
    reason TEXT,
    seen_at TEXT
  ) WITHOUT ROWID`
})
