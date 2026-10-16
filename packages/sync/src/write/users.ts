import type { User } from '@juno/slack-schema'
import { StoreWriter, type UserRow } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'

const displayName = (user: User): string | null => {
  const display = user.profile?.display_name?.trim()
  if (display) return display
  const real = user.profile?.real_name?.trim() || user.real_name?.trim()
  if (real) return real
  return user.name ?? null
}

export const toUserRow = (user: User): UserRow => ({
  id: user.id,
  name: user.name ?? null,
  display_name: displayName(user),
  real_name: user.profile?.real_name ?? user.real_name ?? null,
  avatar_url: user.profile?.image_72 ?? user.profile?.image_48 ?? user.profile?.image_192 ?? null,
  tz: user.tz ?? null,
  is_bot: user.is_bot === true ? 1 : 0,
  deleted: user.deleted === true ? 1 : 0,
  updated: user.updated === undefined ? null : String(user.updated),
})

export const upsertUsers = (users: ReadonlyArray<User>): Writer =>
  Effect.gen(function* () {
    if (users.length === 0) return
    const sql = yield* StoreWriter
    for (const user of users) {
      const row = toUserRow(user)
      yield* sql`INSERT INTO users ${sql.insert(row as unknown as Record<string, unknown>)}
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, display_name = excluded.display_name, real_name = excluded.real_name,
          avatar_url = excluded.avatar_url, tz = excluded.tz, is_bot = excluded.is_bot, deleted = excluded.deleted, updated = excluded.updated`
    }
    yield* invalidate(syncKeys.users)
  })
