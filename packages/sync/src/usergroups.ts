/**
 * The workspace's user groups, so a group mention shows "@handle" (research
 * section 3, User groups). `client.userBoot` lists only the ids of the
 * user's own groups, and message text carries a bare `<!subteam^S…>`, so the
 * handles come from `usergroups.list` once per boot and from `subteam_*`
 * socket events. Topics whose preview met an unknown group are re-indexed
 * when the groups land.
 */
import type { UsergroupId } from '@juno/domain'
import { SlackApi } from '@juno/slack'
import type { Subteam } from '@juno/slack-schema'
import { transaction, type Invalidation, type SqlError, type StoreWriter } from '@juno/store'
import { Effect } from 'effect'
import { reindexOptions, type SyncContext } from './context'
import { ME_KEY } from './boot'
import { reindexTopics } from './reindex'
import { setSyncState, upsertUsergroups } from './write'

/** Stores `groups` and re-indexes the topics that waited for a group's handle. Runs inside the caller's transaction. */
export const applyUsergroups = (ctx: SyncContext, groups: ReadonlyArray<Subteam>): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    yield* upsertUsergroups(groups)
    if (ctx.usergroupTopics.size === 0) return
    const waiting = [...ctx.usergroupTopics]
    ctx.usergroupTopics.clear()
    yield* reindexTopics(waiting, reindexOptions(ctx))
  })

/** Every group, deleted ones too, on the background lane. */
export const syncUsergroups = (ctx: SyncContext) =>
  Effect.gen(function* () {
    const api = yield* SlackApi
    const answer = yield* api.call('usergroups.list', { include_disabled: true }, { lane: 'background', reason: 'usergroups' })
    yield* transaction(applyUsergroups(ctx, answer.usergroups))
  }).pipe(Effect.withSpan('sync.usergroups'))

/**
 * The user joined or left a group: the mention rules change from now on.
 * Messages already indexed keep their counts until their topic is indexed
 * again. Runs inside the caller's transaction.
 */
export const changeOwnUsergroup = (ctx: SyncContext, id: string, joined: boolean): Effect.Effect<void, SqlError, StoreWriter | Invalidation> =>
  Effect.gen(function* () {
    const current = ctx.me.usergroupIds ?? []
    const has = current.includes(id as UsergroupId)
    if (has === joined) return
    ctx.me = { ...ctx.me, usergroupIds: joined ? [...current, id as UsergroupId] : current.filter((group) => group !== id) }
    yield* setSyncState(ME_KEY, ctx.me)
  })
