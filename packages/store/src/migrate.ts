import { Effect } from 'effect'
import { Migrator, type SqlClient } from 'effect/sql'
import type { SqlError } from 'effect/sql/SqlError'

export type { MigrationError } from 'effect/sql/Migrator'

/** The table the Migrator records applied migration ids in, in each database. */
export const MIGRATIONS_TABLE = 'juno_migrations'

/**
 * Runs the migrations in `migrations` that the database has not recorded yet,
 * in id order, inside one transaction on the current `SqlClient`. Returns the
 * ids and names it applied; an empty array means the schema was up to date.
 */
export const migrate = (
  migrations: Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>,
): Effect.Effect<
  ReadonlyArray<readonly [id: number, name: string]>,
  Migrator.MigrationError | SqlError,
  SqlClient.SqlClient
> => Migrator.make({})({ loader: Migrator.fromRecord(migrations), table: MIGRATIONS_TABLE })
