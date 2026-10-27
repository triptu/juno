/**
 * The sender of `DraftSync` (`draftSync.ts`): one call for a topic's due
 * `draft` row, with the topic's text as it is now, and its answer.
 *
 * - `drafts.update` for the draft Juno links, with the local edit time as
 *   `client_last_updated_ts`; `drafts.create` when it links none (not while a
 *   list looks for the place's draft); `drafts.delete` for a draft the user
 *   cleared. Nothing for a draft with files: Juno never changes one.
 * - `attached_draft_exists`: the place has a draft Juno does not link; a
 *   list finds it, and the rule decides between the two.
 * - A draft Slack no longer has live (`draft_update_invalid` and the like)
 *   is gone for Juno; text still to save goes as a new draft.
 * - A lost answer or a dropped connection: the row stays, and Slack may have
 *   run the call, so a list follows. A rate limit or no session: the row
 *   waits. Any other refusal settles the generation it sent: that text stays
 *   in Juno only, and a newer edit still goes.
 * - Juno deletes nothing on its own: a draft that went with a post naming it
 *   is retired by Slack, and any other stays where it is.
 */
import { Clock, Effect } from 'effect'
import { composeOutgoing } from '@juno/richtext'
import type { SlackApiError } from '@juno/slack'
import { StoreWriter, transaction, type SqlError } from '@juno/store'
import { claimDraftSave, deferDraftSave, draftDestination, draftSyncRow, dropDraftSave, endDraftSave, refuseDraftSave, type DraftAnswer, type DraftClaim, type PendingDraft } from '@juno/sync'
import { WorkControl } from './workControl'
import type { EngineTimingConfig } from './config'
import type { MirrorError, Outbox } from './outbox'
import { inStore, stampOf, type Blocks, type Draft, type DraftDestination } from './draftVersions'
import type { OpenWorkspace, StoreServices } from './workspace'

export interface SenderDeps {
  readonly outbox: Outbox['Service']
  readonly timing: EngineTimingConfig
  /** Asks for a list of Slack's drafts soon. */
  readonly listSoon: Effect.Effect<void>
}

/** One call for the topic's row, if it is due, and its answer. */
export const sendDraftRow = (deps: SenderDeps, open: OpenWorkspace, topicId: string) =>
  deps.outbox.exclusive(`draft:${topicId}`)(
    Effect.gen(function* () {
      const local = inStore(open)
      const now = yield* Clock.currentTimeMillis
      const first = yield* local(draftSyncRow(topicId))
      if (first.row === undefined || first.row.nextAt > now) return
      const destination = yield* local(draftDestination(topicId))
      // A thread Juno started waits for its root's ts; a topic that is no place has nothing to sync.
      if (destination === undefined) return yield* local(topicId.startsWith('p:') ? later(topicId, now + deps.timing.noSessionMillis) : dropDraftSave(topicId))
      const control = yield* WorkControl
      const hold = control.onDraftWrite?.('claim', topicId, 'before')
      if (hold !== undefined) yield* Effect.promise(() => hold)
      // Read and claimed together: a version from Slack that replaced the intent meanwhile leaves nothing to send.
      const claim = yield* local(transaction(claimDraftSave(topicId, yield* Clock.currentTimeMillis, deps.timing.retryBaseMillis, () => crypto.randomUUID())))
      control.onDraftWrite?.('claim', topicId, 'after')
      if (claim === undefined) return
      const places: ReadonlyArray<DraftDestination> = [{ channel_id: destination.channel, ...(destination.threadTs === undefined ? {} : { thread_ts: destination.threadTs, broadcast: false }) }]
      const result = yield* Effect.result(deps.outbox.send((api) => call(api, claim, places)))
      const answeredAt = yield* Clock.currentTimeMillis
      if (result._tag === 'Success') return yield* local(transaction(endDraftSave(topicId, claim.gen, result.success, answeredAt)))
      yield* settleFailure(deps, open, topicId, first.row, claim, result.failure, answeredAt)
    }),
  )

const call = (api: Parameters<Parameters<Outbox['Service']['send']>[0]>[0], claim: DraftClaim, places: ReadonlyArray<DraftDestination>): Effect.Effect<DraftAnswer, SlackApiError> => {
  const edited = String(Math.round(claim.editedAt))
  const reason = { reason: 'MessageInput:updateDraft' }
  switch (claim.op) {
    case 'create':
      return Effect.map(api.call('drafts.create', { blocks: blocksOf(claim.text), client_msg_id: claim.clientMsgId!, destinations: places, file_ids: [], is_from_composer: false }, reason), (answer) => saved(answer.draft, claim.text))
    case 'update':
      // Juno updates only a draft with no files.
      return Effect.map(
        api.call('drafts.update', { draft_id: claim.slackId!, client_last_updated_ts: edited, blocks: blocksOf(claim.text), destinations: places, file_ids: [], is_from_composer: false }, reason),
        (answer) => saved(answer.draft, claim.text),
      )
    case 'delete':
      return Effect.as(api.call('drafts.delete', { draft_id: claim.slackId!, client_last_updated_ts: edited, skip_file_deletion: true }, reason), { kind: 'deleted', id: claim.slackId! } as const)
  }
}

/** What a refused or failed call means for the row. */
const settleFailure = (deps: SenderDeps, open: OpenWorkspace, topicId: string, row: PendingDraft, claim: DraftClaim, error: MirrorError, at: number) =>
  Effect.gen(function* () {
    const local = inStore(open)
    if (error._tag !== 'Rejected') return yield* defer(deps, open, topicId, row, error, error._tag === 'Offline')
    if (claim.op === 'create' && error.code === 'attached_draft_exists') {
      yield* local(transaction(endDraftSave(topicId, claim.gen, { kind: 'exists' }, at)))
      return yield* deps.listSoon
    }
    if (claim.op !== 'create' && isGone(error)) return yield* local(transaction(endDraftSave(topicId, claim.gen, claim.op === 'delete' ? { kind: 'deleted', id: claim.slackId! } : { kind: 'gone', id: claim.slackId! }, at)))
    // Slack doubts the edit time: the list that follows lets the rule decide.
    if (error.code === 'draft_has_conflict') return yield* defer(deps, open, topicId, row, error, true)
    yield* Effect.logWarning('drafts: Slack refused a draft', { code: error.code })
    yield* local(transaction(refuseDraftSave(topicId, claim.gen)))
  })

/** A transient failure: due again with backoff. A call Slack may have run (`ran`) keeps its text as Juno's own, and a list follows. */
const defer = (deps: SenderDeps, open: OpenWorkspace, topicId: string, row: PendingDraft, error: MirrorError, ran: boolean) =>
  Effect.gen(function* () {
    const at = yield* Clock.currentTimeMillis
    const backoff = Math.min(deps.timing.retryBaseMillis * 2 ** row.attempts, deps.timing.retryCapMillis)
    const wait = error._tag === 'NotSignedIn' ? deps.timing.noSessionMillis : error._tag === 'RateLimited' ? Math.max(error.retryAfterMillis, backoff) : backoff
    yield* inStore(open)(transaction(deferDraftSave(topicId, at + wait, error._tag, at, ran)))
    if (ran) yield* deps.listSoon
  })

/** Puts a row off to `at` without a call. */
const later = (topicId: string, at: number): Effect.Effect<void, SqlError, StoreServices> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE outbox SET next_at = ${String(at)} WHERE kind = 'draft' AND target_key = ${topicId}`
  })

/** Makes a row that waits for a pause in typing due now. */
export const hurry = (topicId: string, now: number): Effect.Effect<void, SqlError, StoreServices> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    yield* sql`UPDATE outbox SET next_at = ${String(now)} WHERE kind = 'draft' AND target_key = ${topicId} AND CAST(next_at AS INTEGER) > ${now} AND CAST(next_at AS INTEGER) < ${Number.MAX_SAFE_INTEGER}`
  })

/** Codes that say the draft is no longer live: deleted or sent elsewhere (research section 3). */
const isGone = (error: MirrorError): boolean =>
  error._tag === 'Rejected' && ['draft_update_invalid', 'draft_delete_invalid', 'draft_not_found', 'draft_already_deleted', 'draft_already_sent'].includes(error.code)

/** What the composer's text sends: one `rich_text` block, empty for no text, as the official client sends it. */
const blocksOf = (text: string): Blocks => {
  const blocks = composeOutgoing(text).blocks
  return blocks.length === 0 ? [{ type: 'rich_text', elements: [] }] : blocks
}

/** Slack's answer to a save of `text`, which its draft now holds. */
const saved = (draft: Draft, text: string): DraftAnswer => ({ kind: 'saved', id: draft.id, stamp: stampOf(draft.last_updated_ts), files: (draft.file_ids ?? []).length > 0, clientMsgId: draft.client_msg_id, text })
