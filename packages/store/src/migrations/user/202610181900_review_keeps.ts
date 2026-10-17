import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/**
 * The "no" of two Home reviews (`docs/design/settled-suggestions/`, "More
 * self-management").
 *
 * - `follow_ups.match_kept_ts`: the newest message of the user's they said
 *   did not keep the promise (Not done). Only a later match is proposed.
 * - `drafts.kept_at`: the draft's `updated_at` when the user chose Keep.
 *   The draft is not proposed while it is unchanged.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  // Run again safely: a store that already has a column keeps it.
  const has = (table: string, column: string) => sql<{ name: string }>`SELECT name FROM pragma_table_info(${table})`.pipe(Effect.map((columns) => columns.some((c) => c.name === column)))
  if (!(yield* has('follow_ups', 'match_kept_ts'))) yield* sql`ALTER TABLE follow_ups ADD COLUMN match_kept_ts TEXT`
  if (!(yield* has('drafts', 'kept_at'))) yield* sql`ALTER TABLE drafts ADD COLUMN kept_at TEXT`
})
