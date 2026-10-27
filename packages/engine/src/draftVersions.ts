/**
 * Slack's drafts coming in, for `DraftSync` (`draftSync.ts`): the catch-up
 * list of live drafts, and the socket's `draft_*` events, each version
 * turned into the composer's text and applied by `observeDraft`
 * (`@juno/sync`, the rules in `@juno/domain`'s `observeSlackDraft`).
 */
import { Clock, Effect } from 'effect'
import { parseTopicId, type SlackDraft } from '@juno/domain'
import { composeOutgoing, draftMarkup, type Lookups } from '@juno/richtext'
import type { SocketEvent } from '@juno/slack'
import { StoreWriter, transaction, type SqlError } from '@juno/store'
import { draftTopicId, linkedDrafts, observeAbsence, observeDraft, pendingDrafts, settleDraftFinds, topicOfSlackDraft } from '@juno/sync'
import { WorkControl } from './workControl'
import type { Outbox, MirrorError } from './outbox'
import type { OpenWorkspace, StoreServices } from './workspace'

type Frame = Extract<SocketEvent, { readonly _tag: 'Frame' }>['frame']
/** Slack's draft object, as `drafts.*` answers and the socket carry it. */
export type Draft = Extract<Frame, { readonly type: 'draft_create' | 'draft_update' }>['draft']
export type Blocks = NonNullable<Draft['blocks']>
export type DraftDestination = Draft['destinations'][number]
export type DraftFrame = Extract<Frame, { readonly type: 'draft_create' | 'draft_update' | 'draft_delete' | 'draft_send' }>

/** Pages of 100 drafts a list reads at most. */
const LIST_PAGES = 10

/** Slack's "seconds.microseconds" as epoch milliseconds. */
export const stampOf = (ts: string): number => Number(ts) * 1000

/** Two drafts are the same when Slack would store the same blocks for them. */
export const same = (a: string, b: string): boolean => JSON.stringify(composeOutgoing(a).blocks) === JSON.stringify(composeOutgoing(b).blocks)

export const isDraftFrame = (frame: Frame): frame is DraftFrame =>
  frame.type === 'draft_create' || frame.type === 'draft_update' || frame.type === 'draft_delete' || frame.type === 'draft_send'

/** A `draft_*` event, applied to the topic it is for. A removal names only the draft: it counts for the topic that links it. */
export const applyDraftEvent = (frame: DraftFrame, seenAt: number): Effect.Effect<void, SqlError, StoreServices> =>
  Effect.gen(function* () {
    if (frame.type === 'draft_create' || frame.type === 'draft_update') {
      const place = yield* placeOf(frame.draft)
      if (place !== undefined) yield* transaction(applyVersion(place, frame.draft, { seenAt, listed: false }))
      return
    }
    const clientMsgId = 'client_msg_id' in frame ? frame.client_msg_id : undefined
    const topicId = yield* topicOfSlackDraft(frame.draft_id, clientMsgId)
    if (topicId === undefined) return
    const removed = { id: frame.draft_id, text: '', stamp: frame.event_ts === undefined ? seenAt : stampOf(frame.event_ts), deleted: true, ...(clientMsgId === undefined ? {} : { clientMsgId }) }
    yield* transaction(observeDraft(topicId, removed, { seenAt, same }))
  })

/**
 * Slack's live drafts, each applied, and the linked ones a complete list no longer has applied as deleted.
 * Returns whether another list is needed: a call was out, a draft was linked after the request, the list
 * was cut short, or a find or a lost call's text is still open (it began no earlier than the request, in
 * the same millisecond included).
 */
export const listDrafts = (open: OpenWorkspace, outbox: Outbox['Service']): Effect.Effect<boolean, MirrorError> =>
  Effect.gen(function* () {
    const local = inStore(open)
    const requestedAt = yield* Clock.currentTimeMillis
    const drafts: Array<Draft> = []
    let nextTs: string | undefined
    let complete = false
    for (let page = 0; page < LIST_PAGES && !complete; page++) {
      const answer = yield* outbox.sendBackground((api) => api.call('drafts.list', { is_active: true, limit: 100, ...(nextTs === undefined ? {} : { next_ts: nextTs }) }, { reason: 'fetchDraftsOnReconnect' }))
      drafts.push(...answer.drafts)
      nextTs = answer.drafts.at(-1)?.last_updated_ts
      complete = answer.has_more !== true || nextTs === undefined
    }
    const listed = new Set<string>()
    for (const draft of drafts) {
      const place = yield* local(placeOf(draft))
      if (place === undefined) continue
      listed.add(draft.id)
      yield* local(transaction(applyVersion(place, draft, { seenAt: requestedAt, listed: true })))
    }
    if (complete) {
      const control = yield* WorkControl
      for (const link of yield* local(linkedDrafts)) {
        if (listed.has(link.slackId) || link.seenAt >= requestedAt) continue
        const hold = control.onDraftWrite?.('absence', link.topicId, 'before')
        if (hold !== undefined) yield* Effect.promise(() => hold)
        // The link is read again in the transaction: a draft linked since the read above is left alone.
        yield* local(transaction(observeAbsence(link.topicId, link.slackId, requestedAt, same)))
        control.onDraftWrite?.('absence', link.topicId, 'after')
      }
    }
    yield* local(transaction(settleDraftFinds(requestedAt)))
    const rows = yield* local(pendingDrafts)
    const links = yield* local(linkedDrafts)
    return !complete || rows.some((row) => row.sending !== undefined || row.findAt > 0 || row.unsure.length > 0) || links.some((link) => link.seenAt >= requestedAt)
  })

/** The topic an attached draft of a known conversation sits in; `undefined` for any other draft (composer, scheduled, stashed). */
const placeOf = (draft: Draft): Effect.Effect<string | undefined, SqlError, StoreServices> =>
  Effect.gen(function* () {
    if (draft.is_from_composer === true || (draft.date_scheduled ?? 0) > 0 || draft.date_stashed !== undefined || draft.destinations.length !== 1) return undefined
    const destination = draft.destinations[0]!
    const channel = destination.channel_id
    if (channel === undefined) return undefined
    const sql = yield* StoreWriter
    if ((yield* sql<{ id: string }>`SELECT id FROM conversations WHERE id = ${channel}`)[0] === undefined) return undefined
    const id = destination.thread_ts === undefined ? `m:${channel}` : `t:${channel}:${destination.thread_ts}`
    if (parseTopicId(id) === undefined) return undefined
    return yield* draftTopicId(sql, id)
  })

/** Slack's draft as a version of a place's draft, its text as the composer's. A live draft of files alone has no text, and is not a deletion. */
const versionOf = (draft: Draft): Effect.Effect<SlackDraft & { readonly files: boolean }, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const deleted = draft.is_deleted === true || draft.is_sent === true
    const blocks = draft.blocks ?? []
    const markup = deleted ? '' : draftMarkup(blocks, yield* draftLookups(blocks))
    return { id: draft.id, text: markup.trim() === '' ? '' : markup, stamp: stampOf(draft.last_updated_ts), deleted, files: (draft.file_ids ?? []).length > 0, clientMsgId: draft.client_msg_id }
  })

const applyVersion = (topicId: string, draft: Draft, how: { readonly seenAt: number; readonly listed: boolean }) =>
  Effect.gen(function* () {
    return yield* observeDraft(topicId, yield* versionOf(draft), { ...how, same })
  })

/** Names for the people, channels and user groups a draft mentions, so the composer shows them as picks. */
const draftLookups = (blocks: Blocks): Effect.Effect<Lookups, SqlError, StoreWriter> =>
  Effect.gen(function* () {
    const ids = { user: new Set<string>(), channel: new Set<string>(), usergroup: new Set<string>() }
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit)
      if (value === null || typeof value !== 'object') return
      const element = value as Record<string, unknown>
      for (const kind of ['user', 'channel', 'usergroup'] as const) {
        const id = element[`${kind}_id`]
        if (element['type'] === kind && typeof id === 'string') ids[kind].add(id)
      }
      visit(element['elements'])
    }
    visit(blocks)
    if (ids.user.size + ids.channel.size + ids.usergroup.size === 0) return {}
    const sql = yield* StoreWriter
    const people = new Map((yield* sql<{ id: string; name: string | null; display_name: string | null; real_name: string | null }>`
      SELECT id, name, display_name, real_name FROM users WHERE id IN ${sql.in([...ids.user, ''])}`).map((row) => [row.id, row.display_name || row.real_name || row.name || undefined]))
    const places = new Map((yield* sql<{ id: string; name: string | null }>`SELECT id, name FROM conversations WHERE id IN ${sql.in([...ids.channel, ''])}`).map((row) => [row.id, row.name ?? undefined]))
    const groups = new Map((yield* sql<{ id: string; handle: string; name: string | null }>`SELECT id, handle, name FROM usergroups WHERE id IN ${sql.in([...ids.usergroup, ''])}`)
      .map((row) => [row.id, { handle: row.handle, ...(row.name === null ? {} : { name: row.name }) }]))
    return { user: (id) => people.get(id), channel: (id) => places.get(id), usergroup: (id) => groups.get(id) }
  })

/** Runs a store effect in the open workspace. A store failure is a bug (architecture 2.6). */
export const inStore =
  (open: OpenWorkspace) =>
  <A>(effect: Effect.Effect<A, SqlError, StoreServices>): Effect.Effect<A> =>
    effect.pipe(Effect.provide(open.context), Effect.orDie)
