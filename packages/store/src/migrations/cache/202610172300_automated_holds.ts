import { SqlClient } from 'effect/sql'
import { Effect } from 'effect'

/**
 * The channels the first sync keeps out of All until Automated's rules
 * have read their history (`@juno/engine` `automatedView.ts`, SPEC section
 * 5, "Automated"), so a channel the rules move never shows in All first.
 * Emptied as each one is decided, and all at once after a few seconds or
 * when the boot ends. In the cache: a new first sync holds them again.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE automated_holds (channel TEXT PRIMARY KEY) WITHOUT ROWID`
})
