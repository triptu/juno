import type { Effect } from 'effect'
import type { SqlClient } from 'effect/sql'
import initial from './202610121200_initial'
import overlayPinned from './202610131000_overlay_pinned'
import search from './202610140100_search'
import readMirror from './202610141200_read_mirror'

/**
 * Migrations for `user.db`, keyed `<timestamp>_<name>`. Add a file per change
 * with a new timestamp id and list it here; the Migrator runs the ones not yet
 * recorded, in id order. Never edit a migration that has shipped.
 */
export const userMigrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>> = {
  '202610121200_initial': initial,
  '202610131000_overlay_pinned': overlayPinned,
  '202610140100_search': search,
  '202610141200_read_mirror': readMirror,
}
