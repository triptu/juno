/**
 * Sidebar views (spec section 5 "Views", architecture 4.3): what the views
 * routes read and write in `user.db`. Nothing goes to Slack.
 *
 * Every write runs in one writer transaction, invalidates `sidebar_views`
 * (which the sidebar list, its counts and `views.list` follow) and returns
 * the undo computed from the state before it, or none when nothing changed
 * (ADR 0010).
 *
 * `saveView` is the whole-view command the sheet uses. A Juno settings tool
 * ("make a Bots view with every alerts channel") calls it the same way once
 * the agent has a host route for it.
 */
import { randomUUID } from 'node:crypto'
import { Clock, Effect } from 'effect'
import { NotFound, NotSignedIn, type AutomatedPlace, type CommandResult, type SavedView, type SidebarView, type ViewDraft } from '@juno/contract'
import { AUTOMATED_VIEW_ID, viewName, type ViewIcon } from '@juno/domain'
import { invalidate, keys, StoreReader, StoreWriter, transaction, type Invalidation, type SqlError } from '@juno/store'
import { leaveAutomated, moveToAutomated, placedByHand, setVerdict } from './automatedView'
import { channelInfoOf, channelRefOf, userName, type UserRow } from './topicRows'
import { Workspace } from './workspace'

interface ViewRow {
  readonly id: string
  readonly name: string
  readonly icon: string | null
  readonly position: number
  readonly keep_out_of_all: number
}

const savedOf = (row: ViewRow, channels: ReadonlyArray<string>): SavedView => ({
  id: row.id,
  name: row.name,
  ...(row.icon === null ? {} : { icon: row.icon as ViewIcon }),
  keepOutOfAll: row.keep_out_of_all === 1,
  channels,
  position: row.position,
})

/** A view as stored, or undefined. */
export const readView = (id: string): Effect.Effect<SavedView | undefined, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const row = (yield* sql<ViewRow>`SELECT id, name, icon, position, keep_out_of_all FROM sidebar_views WHERE id = ${id}`)[0]
    if (row === undefined) return undefined
    const channels = yield* sql<{ channel: string }>`SELECT channel FROM sidebar_view_channels WHERE view_id = ${id} ORDER BY added_at, channel`
    return savedOf(row, channels.map((c) => c.channel))
  })

const writeChannels = (id: string, channels: ReadonlyArray<string>, now: number) =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    for (const channel of new Set(channels)) {
      yield* sql`INSERT OR IGNORE INTO sidebar_view_channels (view_id, channel, added_at) VALUES (${id}, ${channel}, ${String(now)})`
    }
  })

/** Runs `step` in one writer transaction of the open workspace; `NotSignedIn` without one. A store failure is a defect. */
const inWorkspace = <A>(step: (now: number) => Effect.Effect<A, SqlError, StoreWriter | Invalidation>) =>
  Effect.gen(function* () {
    const open = yield* (yield* Workspace).current
    if (open === undefined) return yield* new NotSignedIn()
    const now = yield* Clock.currentTimeMillis
    return yield* transaction(Effect.flatMap(step(now), (result) => Effect.as(invalidate([...keys.sidebarViews, ...keys.automatedChannels]), result))).pipe(
      Effect.provide(open.context),
      Effect.orDie,
    )
  })

/** Creates a view (last in the row) or replaces one whole. A blank name, or an id the store does not know, is `NotFound`. */
export const saveView = (draft: ViewDraft) =>
  Effect.gen(function* () {
    const name = viewName(draft.name)
    if (name === '') return yield* new NotFound({ kind: 'name', id: draft.name })
    const outcome = yield* inWorkspace((now) =>
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        const icon = draft.icon ?? null
        const keep = draft.keepOutOfAll ? 1 : 0
        if (draft.id !== undefined) {
          const before = yield* readView(draft.id)
          if (before === undefined) return undefined
          yield* sql`UPDATE sidebar_views SET name = ${name}, icon = ${icon}, keep_out_of_all = ${keep} WHERE id = ${draft.id}`
          // Conversations that stay keep their place; the rest go.
          const kept = new Set(draft.channels)
          const previousChannels = yield* sql<{ channel: string }>`SELECT channel FROM sidebar_view_channels WHERE view_id = ${draft.id}`
          for (const { channel } of previousChannels) if (!kept.has(channel)) yield* sql`DELETE FROM sidebar_view_channels WHERE view_id = ${draft.id} AND channel = ${channel}`
          yield* writeChannels(draft.id, draft.channels, now)
          const was = new Set(before.channels)
          yield* placedByHand(
            draft.id,
            [...before.channels.filter((channel) => !kept.has(channel)).map((channel) => ({ channel, member: false })), ...[...kept].filter((channel) => !was.has(channel)).map((channel) => ({ channel, member: true }))],
            now,
          )
          return { id: draft.id, before, after: (yield* readView(draft.id))! }
        }
        const id = `v${randomUUID().replaceAll('-', '').slice(0, 12)}`
        const last = (yield* sql<{ position: number | null }>`SELECT max(position) AS position FROM sidebar_views`)[0]?.position ?? -1
        yield* sql`INSERT INTO sidebar_views (id, name, icon, position, keep_out_of_all, created_at) VALUES (${id}, ${name}, ${icon}, ${last + 1}, ${keep}, ${String(now)})`
        yield* writeChannels(id, draft.channels, now)
        yield* placedByHand(id, [...new Set(draft.channels)].map((channel) => ({ channel, member: true })), now)
        return { id, before: null, after: (yield* readView(id))! }
      }),
    )
    if (outcome === undefined) return yield* new NotFound({ kind: 'view', id: draft.id ?? '' })
    return outcome
  })

/** Deletes a view. The undo puts it back whole. */
export const deleteView = (id: string) =>
  Effect.gen(function* () {
    const saved = yield* inWorkspace(() =>
      Effect.gen(function* () {
        const view = yield* readView(id)
        if (view === undefined) return undefined
        const sql = yield* StoreWriter
        yield* sql`DELETE FROM sidebar_view_channels WHERE view_id = ${id}`
        yield* sql`DELETE FROM sidebar_views WHERE id = ${id}`
        return view
      }),
    )
    if (saved === undefined) return yield* new NotFound({ kind: 'view', id })
    return { undo: { _tag: 'views.restore', view: saved } } satisfies CommandResult
  })

/** Puts a deleted view back with its id and place. A view that is there already is left as it is. */
export const restoreView = (view: SavedView) =>
  inWorkspace((now) =>
    Effect.gen(function* () {
      const sql = yield* StoreWriter
      if ((yield* sql<{ id: string }>`SELECT id FROM sidebar_views WHERE id = ${view.id}`).length > 0) return {}
      yield* sql`INSERT INTO sidebar_views (id, name, icon, position, keep_out_of_all, created_at)
        VALUES (${view.id}, ${view.name}, ${view.icon ?? null}, ${view.position}, ${view.keepOutOfAll ? 1 : 0}, ${String(now)})`
      yield* writeChannels(view.id, view.channels, now)
      return {} satisfies CommandResult
    }),
  )

/** Adds a conversation to a view, or removes it. The undo does the opposite; nothing changed, no undo. */
export const setViewChannel = (id: string, channel: string, member: boolean) =>
  Effect.gen(function* () {
    const outcome = yield* inWorkspace((now) =>
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        if ((yield* sql<{ id: string }>`SELECT id FROM sidebar_views WHERE id = ${id}`).length === 0) return 'missing' as const
        const there = (yield* sql<{ channel: string }>`SELECT channel FROM sidebar_view_channels WHERE view_id = ${id} AND channel = ${channel}`).length > 0
        if (there === member) return false
        if (member) yield* writeChannels(id, [channel], now)
        else yield* sql`DELETE FROM sidebar_view_channels WHERE view_id = ${id} AND channel = ${channel}`
        yield* placedByHand(id, [{ channel, member }], now)
        return true
      }),
    )
    if (outcome === 'missing') return yield* new NotFound({ kind: 'view', id })
    if (!outcome) return {} satisfies CommandResult
    return { undo: { _tag: member ? 'views.removeChannel' : 'views.addChannel', id, channel } } satisfies CommandResult
  })

/** The pill order. Views the list does not name keep their order, after it. */
export const reorderViews = (ids: ReadonlyArray<string>) =>
  inWorkspace(() =>
    Effect.gen(function* () {
      const sql = yield* StoreWriter
      const rows = yield* sql<{ id: string }>`SELECT id FROM sidebar_views ORDER BY position, id`
      const named = new Set(ids)
      const order = [...ids.filter((id) => rows.some((row) => row.id === id)), ...rows.map((row) => row.id).filter((id) => !named.has(id))]
      for (const [position, id] of order.entries()) yield* sql`UPDATE sidebar_views SET position = ${position} WHERE id = ${id} AND position <> ${position}`
    }),
  )

/**
 * The user's answer about Automated (Home's Move and Keep in All), or its
 * undo (`ask`, or the earlier answer). Move makes the view if needed, even
 * one the user deleted, since they asked for it. The undo is the place the
 * conversation had before; nothing changed, no undo.
 */
export const sortChannel = (channel: string, to: AutomatedPlace) =>
  Effect.gen(function* () {
    const before = yield* inWorkspace((now) =>
      Effect.gen(function* () {
        const sql = yield* StoreWriter
        const inView = (yield* sql<{ n: number }>`SELECT count(*) AS n FROM sidebar_view_channels WHERE view_id = ${AUTOMATED_VIEW_ID} AND channel = ${channel}`)[0]?.n === 1
        const row = (yield* sql<{ verdict: string; by: string }>`SELECT verdict, by FROM automated_channels WHERE channel = ${channel}`)[0]
        const place: AutomatedPlace = inView ? 'automated' : row?.verdict === 'kept' ? 'kept' : 'ask'
        if (place === to && (to === 'ask' || row?.by === 'you')) return undefined
        if (to === 'automated') yield* moveToAutomated(channel, 'you', now)
        else {
          yield* leaveAutomated(channel)
          // Back to a question the rules asked; the job looks at it again when the conversation moves.
          yield* setVerdict(channel, to, to === 'ask' ? 'rules' : 'you', now)
        }
        return place
      }),
    )
    if (before === undefined) return {} satisfies CommandResult
    return { undo: { _tag: 'views.sortChannel', channel, to: before } } satisfies CommandResult
  })

interface MemberRow extends ViewRow {
  readonly channel: string | null
  readonly c_kind: 'public' | 'private' | 'im' | 'mpim' | null
  readonly c_name: string | null
  readonly c_user_id: string | null
  readonly c_members: string | null
}

/** Every view in pill order, with the conversations the store knows, named as rows name them. */
export const listViews: Effect.Effect<ReadonlyArray<SidebarView>, SqlError, StoreReader> = Effect.gen(function* () {
  const sql = yield* StoreReader
  const rows = yield* sql<MemberRow>`SELECT v.id, v.name, v.icon, v.position, v.keep_out_of_all, vc.channel,
      c.kind AS c_kind, c.name AS c_name, c.user_id AS c_user_id, c.member_ids_json AS c_members
    FROM sidebar_views v
    LEFT JOIN sidebar_view_channels vc ON vc.view_id = v.id
    LEFT JOIN conversations c ON c.id = vc.channel
    ORDER BY v.position, v.id, vc.added_at, vc.channel`
  const selfId = (yield* sql<{ self_user_id: string | null }>`SELECT self_user_id FROM team LIMIT 1`)[0]?.self_user_id ?? undefined
  const members = new Map<MemberRow, ReadonlyArray<string>>()
  const userIds = new Set<string>()
  for (const row of rows) {
    if (row.c_kind === null) continue
    const ids = row.c_members === null ? [] : (JSON.parse(row.c_members) as ReadonlyArray<string>)
    members.set(row, ids)
    if (row.c_user_id !== null) userIds.add(row.c_user_id)
    for (const id of ids) userIds.add(id)
  }
  const users = new Map<string, UserRow>()
  if (userIds.size > 0) for (const user of yield* sql<UserRow>`SELECT id, name, display_name, real_name, avatar_url, avatar_small_url, avatar_large_url FROM users WHERE id IN ${sql.in([...userIds])}`) users.set(user.id, user)
  const nameOf = (id: string) => userName(id, users.get(id))
  const byJuno = rows.some((row) => row.id === AUTOMATED_VIEW_ID)
    ? (yield* sql<{ channel: string }>`SELECT channel FROM automated_channels WHERE verdict = 'automated' AND by IN ('rules', 'juno')`).map((row) => row.channel)
    : []

  const views: Array<SidebarView & { channels: Array<SidebarView['channels'][number]> }> = []
  for (const row of rows) {
    let view = views.at(-1)
    if (view?.id !== row.id) {
      view = {
        id: row.id,
        name: row.name,
        ...(row.icon === null ? {} : { icon: row.icon as ViewIcon }),
        keepOutOfAll: row.keep_out_of_all === 1,
        channels: [],
        ...(row.id === AUTOMATED_VIEW_ID ? { addedByJuno: byJuno } : {}),
      }
      views.push(view)
    }
    const ids = members.get(row)
    if (row.channel === null || row.c_kind === null || ids === undefined) continue
    const info = channelInfoOf({ channel: row.channel, c_kind: row.c_kind, c_name: row.c_name, c_user_id: row.c_user_id }, { members: ids }, selfId, nameOf)
    view.channels.push(channelRefOf(info, row.c_kind === 'im' ? (row.c_user_id ?? undefined) : undefined))
  }
  return views
})

/** Raw membership, including conversations no longer in the Slack cache. */
export const savedViews = Effect.gen(function* () {
  const sql = yield* StoreWriter
  const ids = yield* sql<{ id: string }>`SELECT id FROM sidebar_views ORDER BY position, id`
  return yield* Effect.forEach(ids, ({ id }) => readView(id).pipe(Effect.map((view) => view!)))
})

/** Undo only the exact state the command left; never overwrite a later edit. */
export const undoView = (id: string, expected: SavedView | null, restore: SavedView | null) =>
  inWorkspace((now) => Effect.gen(function* () {
    const current = (yield* readView(id)) ?? null
    const same = (a: SavedView | null, b: SavedView | null) => a === null || b === null ? a === b :
      a.id === b.id && a.name === b.name && a.icon === b.icon && a.keepOutOfAll === b.keepOutOfAll && a.position === b.position &&
      a.channels.toSorted().join('\0') === b.channels.toSorted().join('\0')
    if (same(current, restore)) return true
    if (!same(current, expected)) return false
    const sql = yield* StoreWriter
    yield* sql`DELETE FROM sidebar_view_channels WHERE view_id = ${id}`
    yield* sql`DELETE FROM sidebar_views WHERE id = ${id}`
    if (restore !== null) {
      yield* sql`INSERT INTO sidebar_views (id, name, icon, position, keep_out_of_all, created_at)
        VALUES (${id}, ${restore.name}, ${restore.icon ?? null}, ${restore.position}, ${restore.keepOutOfAll ? 1 : 0}, ${String(now)})`
      yield* writeChannels(id, restore.channels, now)
    }
    return true
  }))
