import type { Subteam } from '@juno/slack-schema'
import { StoreWriter, type UsergroupRow } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'

/** A group with `date_delete` set is deleted; its row keeps the last handle so old mentions still read. */
export const toUsergroupRow = (group: Subteam): UsergroupRow => ({
  id: group.id,
  handle: group.handle,
  name: group.name || null,
  deleted: (group.date_delete ?? 0) > 0 ? 1 : 0,
})

export const upsertUsergroups = (groups: ReadonlyArray<Subteam>): Writer =>
  Effect.gen(function* () {
    if (groups.length === 0) return
    const sql = yield* StoreWriter
    const stored = new Map<string, UsergroupRow>()
    for (const row of yield* sql<UsergroupRow>`SELECT id, handle, name, deleted FROM usergroups`) stored.set(row.id, row)
    // Only what changed is written, so the boot's list re-runs no query when the groups are the same.
    let changed = false
    for (const group of groups) {
      if (group.handle === '') continue
      const row = toUsergroupRow(group)
      const held = stored.get(row.id)
      if (held !== undefined && held.handle === row.handle && held.name === row.name && held.deleted === row.deleted) continue
      changed = true
      yield* sql`INSERT INTO usergroups ${sql.insert(row as unknown as Record<string, unknown>)}
        ON CONFLICT (id) DO UPDATE SET handle = excluded.handle, name = excluded.name, deleted = excluded.deleted`
    }
    if (changed) yield* invalidate(syncKeys.usergroups)
  })
