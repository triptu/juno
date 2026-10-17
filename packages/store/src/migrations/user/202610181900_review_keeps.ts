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
  yield* sql`ALTER TABLE follow_ups ADD COLUMN match_kept_ts TEXT`
  yield* sql`ALTER TABLE drafts ADD COLUMN kept_at TEXT`
})
