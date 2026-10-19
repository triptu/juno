/**
 * Reads of workspaces whose store is not open: read-only, with no
 * migrations. For what the engine must know about every workspace on this
 * Mac at boot, such as the huddle leaves that must still happen.
 */
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Effect } from 'effect'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { StoreIoError, type StoreError } from './clients'
import { Invalidation } from './invalidation'
import { USER_DB_FILE, workspacePaths } from './paths'

/** The workspaces under `userData` that have a user.db. */
export const listWorkspaces = (userData: string): Effect.Effect<ReadonlyArray<string>, StoreIoError> => {
  const dir = path.join(userData, 'workspaces')
  return Effect.tryPromise({
    try: async () => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? [] : Promise.reject(error)))
      const found: Array<string> = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const exists = await fs.access(path.join(dir, entry.name, USER_DB_FILE)).then(() => true, () => false)
        if (exists) found.push(entry.name)
      }
      return found
    },
    catch: (cause) => new StoreIoError({ path: dir, cause }),
  })
}

/** One user.db pref of `workspaceId` as its stored JSON text, or undefined when it is not set. */
export const peekUserPref = (userData: string, workspaceId: string, key: string): Effect.Effect<string | undefined, StoreError> =>
  Invalidation.use((invalidation) =>
    Effect.scoped(
      Effect.gen(function* () {
        const sql = yield* SqliteClient.make({ filename: workspacePaths(userData, workspaceId).userDb, readonly: true, disableWAL: true })
        const rows = yield* sql<{ value_json: string }>`SELECT value_json FROM prefs WHERE key = ${key}`
        return rows[0]?.value_json
      }),
    ).pipe(invalidation.provideReactivity),
  ).pipe(Effect.provide(Invalidation.layer))
