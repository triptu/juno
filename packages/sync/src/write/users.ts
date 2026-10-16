import type { User } from '@juno/slack-schema'
import { StoreWriter, type UserRow } from '@juno/store'
import { Effect } from 'effect'
import { syncKeys } from '../keys'

import { invalidate, type Writer } from './shared'
import { getSyncState } from './state'

/** `sync_state` key for `client.userBoot` `team.avatar_base_url`. */
export const AVATAR_BASE_KEY = 'avatar_base_url'
/** Where Slack serves profile photos when the boot has not said (research section 10, "Profile photos"). */
const DEFAULT_AVATAR_BASE = 'https://ca.slack-edge.com/'

const displayName = (user: User): string | null => {
  const display = user.profile?.display_name?.trim()
  if (display) return display
  const real = user.profile?.real_name?.trim() || user.real_name?.trim()
  if (real) return real
  return user.name ?? null
}

/**
 * The photo at `size` px. The edge `users/info` and `client.userBoot` carry
 * no `image_*` urls, only `avatar_hash` (observed live), so the url is built
 * the way the official client builds it: `<base><team>-<user>-<hash>-<size>`.
 * Default photos have a hash too.
 */
const photo = (user: User, base: string, size: number): string | null => {
  const hash = user.profile?.avatar_hash
  const team = user.team_id || user.profile?.team
  return hash && team ? `${base}${team}-${user.id}-${hash}-${size}` : null
}

export const toUserRow = (user: User, avatarBase: string = DEFAULT_AVATAR_BASE): UserRow => ({
  id: user.id,
  name: user.name ?? null,
  display_name: displayName(user),
  real_name: user.profile?.real_name ?? user.real_name ?? null,
  avatar_small_url: user.profile?.image_48 || photo(user, avatarBase, 48),
  avatar_large_url: user.profile?.image_192 || photo(user, avatarBase, 192),
  avatar_url: user.profile?.image_72 || user.profile?.image_192 || user.profile?.image_48 || photo(user, avatarBase, 72),
  tz: user.tz ?? null,
  is_bot: user.is_bot === true ? 1 : 0,
  deleted: user.deleted === true ? 1 : 0,
  updated: user.updated === undefined ? null : String(user.updated),
})

export const upsertUsers = (users: ReadonlyArray<User>): Writer =>
  Effect.gen(function* () {
    if (users.length === 0) return
    const sql = yield* StoreWriter
    const stored = yield* getSyncState<string>(AVATAR_BASE_KEY)
    const base = stored === undefined ? DEFAULT_AVATAR_BASE : stored.endsWith('/') ? stored : `${stored}/`
    for (const user of users) {
      const row = toUserRow(user, base)
      yield* sql`INSERT INTO users ${sql.insert(row as unknown as Record<string, unknown>)}
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, display_name = excluded.display_name, real_name = excluded.real_name,
          avatar_url = excluded.avatar_url, avatar_small_url = excluded.avatar_small_url, avatar_large_url = excluded.avatar_large_url, tz = excluded.tz, is_bot = excluded.is_bot, deleted = excluded.deleted, updated = excluded.updated`
    }
    yield* invalidate(syncKeys.users)
  })
