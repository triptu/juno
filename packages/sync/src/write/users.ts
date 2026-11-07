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
  status_text: user.profile?.status_text ?? null,
  status_emoji: user.profile?.status_emoji ?? null,
  status_expiration: user.profile?.status_expiration ?? null,
})

export const upsertUsers = (users: ReadonlyArray<User>): Writer =>
  Effect.gen(function* () {
    if (users.length === 0) return
    const sql = yield* StoreWriter
    const stored = yield* getSyncState<string>(AVATAR_BASE_KEY)
    const base = stored === undefined ? DEFAULT_AVATAR_BASE : stored.endsWith('/') ? stored : `${stored}/`
    for (const user of users) {
      const row = toUserRow(user, base)
      // A user object without the status fields keeps the stored status; a cleared one carries them empty.
      yield* sql`INSERT INTO users ${sql.insert(row as unknown as Record<string, unknown>)}
        ON CONFLICT (id) DO UPDATE SET name = excluded.name, display_name = excluded.display_name, real_name = excluded.real_name,
          avatar_url = excluded.avatar_url, avatar_small_url = excluded.avatar_small_url, avatar_large_url = excluded.avatar_large_url, tz = excluded.tz, is_bot = excluded.is_bot, deleted = excluded.deleted, updated = excluded.updated,
          status_text = COALESCE(excluded.status_text, users.status_text), status_emoji = COALESCE(excluded.status_emoji, users.status_emoji), status_expiration = COALESCE(excluded.status_expiration, users.status_expiration)`
    }
    yield* invalidate(syncKeys.users)
  })

/**
 * The status Slack took from the user's own `users.profile.set`, stored at
 * once so it shows before the `user_change` Slack sends after it, which
 * writes the same values.
 */
export const writeOwnStatus = (userId: string, status: { readonly text: string; readonly emoji: string; readonly expiration: number }): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE users SET status_text = ${status.text}, status_emoji = ${status.emoji}, status_expiration = ${status.expiration} WHERE id = ${userId}`
    yield* invalidate(syncKeys.users)
  })
