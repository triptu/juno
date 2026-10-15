/** Conversation snapshots keep socket observations made while their reads are in flight. */
import type { Channel } from '@juno/slack-schema'
import type { ConversationRow } from '@juno/store'
import { StoreWriter } from '@juno/store'
import { Effect } from 'effect'
import { patchConversation, setMembership, toConversationRow, upsertConversations } from './write'

type Patch = Partial<Omit<ConversationRow, 'id'>>
export type MetadataRead = Map<string, Patch>
export type MetadataFence = Set<MetadataRead>

/** The work permit serializes snapshot reads, as M7 serializes the recheck after older pages. */
export const readMetadata = <A, E, R>(fence: MetadataFence, read: (observed: MetadataRead) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const observed: MetadataRead = new Map()
      fence.add(observed)
      return observed
    }),
    read,
    (observed) => Effect.sync(() => { fence.delete(observed) }),
  )

const observe = (fence: MetadataFence, id: string, patch: Patch) => Effect.sync(() => {
  for (const read of fence) read.set(id, { ...read.get(id), ...patch })
})

/** Called inside the event's transaction, including when no conversation row exists yet. */
export const patchMetadata = (fence: MetadataFence, id: string, patch: Patch) =>
  patchConversation(id, patch).pipe(Effect.andThen(observe(fence, id, patch)))

export const observeMetadata = (fence: MetadataFence, channel: Channel) => Effect.gen(function* () {
  const row = toConversationRow(channel)
  const patch: Patch = {
    ...(channel.name === undefined ? {} : { name: row.name }),
    ...(channel.user === undefined ? {} : { user_id: row.user_id }),
    ...(channel.members === undefined ? {} : { member_ids_json: row.member_ids_json }),
    ...(channel.is_archived === undefined ? {} : { is_archived: row.is_archived }),
    ...(channel.topic === undefined ? {} : { topic: row.topic }),
    ...(channel.purpose === undefined ? {} : { purpose: row.purpose }),
    ...(channel.created === undefined ? {} : { created: row.created }),
    ...(channel.updated === undefined ? {} : { updated: row.updated }),
    ...(channel.is_channel === undefined && channel.is_group === undefined && channel.is_private === undefined && channel.is_im === undefined && channel.is_mpim === undefined && channel.user === undefined ? {} : { kind: row.kind }),
  }
  const sql = yield* StoreWriter
  const existing = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id = ${channel.id}`
  if (existing.length === 0) yield* upsertConversations([row])
  yield* patchMetadata(fence, channel.id, patch)
})

/** Apply only snapshot fields untouched since the request began. Also handles a previously unknown row. */
export const storeMetadata = (read: MetadataRead, rows: ReadonlyArray<ConversationRow>) =>
  Effect.gen(function* () {
    yield* upsertConversations(rows.map((row) => ({ ...row, ...read.get(row.id) })))
    for (const row of rows) {
      const member = read.get(row.id)?.is_member
      if (member !== undefined) yield* setMembership([row.id], member === 1)
    }
  })

export const storeMembership = (read: MetadataRead, ids: ReadonlyArray<string>, full: boolean) =>
  Effect.gen(function* () {
    if (full) {
      const sql = yield* StoreWriter
      const members = yield* sql<{ id: string }>`SELECT id FROM conversations WHERE is_member = 1`
      const included = new Set(ids)
      yield* setMembership(members.map((row) => row.id).filter((id) => !included.has(id) && read.get(id)?.is_member === undefined), false)
    }
    yield* setMembership(ids.filter((id) => read.get(id)?.is_member === undefined), true)
  })
