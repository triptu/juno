import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'
import { cacheMigrations } from './index'

/**
 * Tests only: the cache migrations plus one later migration, as the next
 * build would ship it. The e2e test of an update opens a synced cache with
 * these and checks that the rows stay and nothing is fetched again.
 */
export const cacheMigrationsWithProbe: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {
  ...cacheMigrations,
  '209912310000_update_probe': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE messages ADD COLUMN update_probe TEXT`
  }),
}
