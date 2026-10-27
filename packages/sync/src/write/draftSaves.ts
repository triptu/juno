import { GONE_KEPT, keptSent } from '@juno/domain'
import { StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import type { Writer } from './shared'
import { draftSyncRow, dropRow, payloadOf, pendingDraft, pendingDrafts, writeRow, writeSync, type DraftSyncRow, type Services } from './drafts'

// The sender's side of a topic's `draft` row (`drafts.ts`, specs/drafts.qnt): a call going out, its answer,
// a lost answer, and what a list settles.

/** The call a claimed row makes, with what it sends, read in the transaction that claimed it. */
export interface DraftClaim {
  readonly op: 'create' | 'update' | 'delete'
  readonly gen: number
  /** The text it saves; `''` for a delete. */
  readonly text: string
  /** The local edit's time, sent as `client_last_updated_ts`. */
  readonly editedAt: number
  readonly slackId?: string
  readonly clientMsgId?: string
}

/**
 * Reads the topic's row and claims it for one call, in one transaction (run it in one): what the stored
 * draft needs now, marked as sending so its echo is known. A cleared draft is deleted only for the user's
 * clear (a local edit, not a send). Nothing is written to a draft a post names while the post waits: the row
 * looks again `retryMillis` later, and typing done meanwhile goes on as a new draft once Slack retires that
 * draft. Nothing is claimed when the row is gone or not due, or when a
 * create must wait for a list to find the place's draft (the list makes the row due again). Nothing is sent
 * for a draft with files, or for a text Slack refused for good: the row waits for a newer change, so the
 * local text stays a local edit. Otherwise, with nothing owed, the row ends. A caller that gets no claim
 * sends nothing. `fresh` makes the `client_msg_id` of a first create; `now` is Juno's clock.
 */
export const claimDraftSave = (topicId: string, now: number, retryMillis: number, fresh: () => string): Effect.Effect<DraftClaim | undefined, SqlError, Services> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const state = yield* draftSyncRow(topicId)
    const row = state.row
    if (row === undefined || row.nextAt > now) return undefined
    const retiring = state.slackId !== undefined && (yield* sql`SELECT 1 FROM pending_messages WHERE draft_id = ${state.slackId} LIMIT 1`).length > 0
    if (retiring) {
      yield* sql`UPDATE outbox SET next_at = ${String(now + retryMillis)} WHERE kind = 'draft' AND target_key = ${topicId}`
      return undefined
    }
    const waits = row.refused === row.gen || (state.slackId !== undefined && state.hasFiles)
    const op = waits ? undefined : state.text !== '' ? (state.slackId !== undefined ? 'update' : 'create') : state.slackId !== undefined && state.pending ? 'delete' : undefined
    if (op === undefined || (op === 'create' && row.findAt > 0)) {
      if (row.findAt > 0 || waits) yield* sql`UPDATE outbox SET next_at = ${String(Number.MAX_SAFE_INTEGER)} WHERE kind = 'draft' AND target_key = ${topicId}`
      else yield* dropRow(topicId)
      return undefined
    }
    const clientMsgId = op === 'create' ? (state.clientMsgId ?? fresh()) : undefined
    if (clientMsgId !== undefined && state.clientMsgId === undefined) yield* writeSync({ ...state, clientMsgId })
    const text = op === 'delete' ? '' : state.text
    yield* writeRow({ ...row, sending: text, creating: op === 'create' }, row.nextAt)
    return {
      op,
      gen: row.gen,
      text,
      // A draft with no time of its own (from before the clear time was kept) goes with now.
      editedAt: state.editedAt > 0 ? state.editedAt : now,
      ...(state.slackId === undefined ? {} : { slackId: state.slackId }),
      ...(clientMsgId === undefined ? {} : { clientMsgId }),
    }
  })

/** What Slack answered a draft call. */
export type DraftAnswer =
  | { readonly kind: 'saved'; readonly id: string; readonly stamp: number; readonly files: boolean; readonly clientMsgId?: string | undefined; readonly text: string }
  /** `attached_draft_exists`: the place has a draft Juno does not link. */
  | { readonly kind: 'exists' }
  /** The update named a draft Slack no longer has live (deleted or sent elsewhere). */
  | { readonly kind: 'gone'; readonly id: string }
  /** The draft named is deleted (also when Slack no longer had it). */
  | { readonly kind: 'deleted'; readonly id: string }

/**
 * Slack answered the call for generation `gen` at `at` (Juno's clock). A save links its draft, unless Juno
 * saw it deleted since (the text then goes again), linked a newer one since, or it is a create whose text went
 * as a message before the answer came (Juno remembers its id, and leaves it); its files and stamp count only
 * when it is newer than what Juno has seen of that draft. The row ends when no newer change replaced its
 * intent and nothing else is owed; otherwise it is due again at once. Returns whether it ended.
 */
export const endDraftSave = (topicId: string, gen: number, answer: DraftAnswer, at: number): Effect.Effect<boolean, SqlError, Services> =>
  Effect.gen(function* () {
    const before = yield* draftSyncRow(topicId)
    const row = before.row
    let state: DraftSyncRow = before
    let settled = true
    switch (answer.kind) {
      case 'saved': {
        const goneSave = before.gone.includes(answer.id)
        const sentCreate = answer.clientMsgId !== undefined && before.sent.some((each) => each.settled !== true && each.clientMsgId === answer.clientMsgId)
        // The answer is older than what Juno knows: of a draft it no longer links, or of the one it links.
        const older = before.slackId !== undefined && (before.slackId === answer.id ? answer.stamp <= (before.slackStamp ?? 0) : answer.stamp < (before.slackStamp ?? 0))
        // The draft a text went from now holds Juno's newer text.
        const sent = keptSent(before.sent.map((each) => (each.id === answer.id && !each.texts.includes(answer.text) ? { ...each, settled: true } : each)))
        if (goneSave) settled = false
        // A create whose text went as a message: remembered by id, and settled at once when its draft is already gone.
        if (sentCreate) state = { ...before, sent: keptSent(before.sent.map((each) => (each.clientMsgId === answer.clientMsgId ? { ...each, id: answer.id, seenAt: at, settled: goneSave } : each))) }
        else if (!goneSave && !older) {
          state = {
            ...before,
            slackId: answer.id,
            seenAt: answer.id === before.slackId && before.seenAt !== undefined ? before.seenAt : at,
            slackStamp: Math.max(before.slackStamp ?? 0, answer.stamp),
            hasFiles: answer.files,
            sent,
            ...(answer.clientMsgId === undefined ? {} : { clientMsgId: answer.clientMsgId }),
          }
        }
        break
      }
      case 'exists':
        settled = false
        break
      case 'gone':
      case 'deleted': {
        const { slackId: _, seenAt: _seen, ...unlinked } = before
        state = {
          ...(before.slackId === answer.id ? unlinked : before),
          gone: [...before.gone.filter((id) => id !== answer.id), answer.id].slice(-GONE_KEPT),
          // The draft a text went from is gone.
          sent: keptSent(before.sent.map((each) => (each.id === answer.id ? { ...each, settled: true } : each))),
        }
        // A delete covers the draft it named; one linked meanwhile still needs its own.
        if (answer.kind === 'gone' || (before.slackId !== undefined && before.slackId !== answer.id)) settled = false
        break
      }
    }
    yield* writeSync(state)
    if (row === undefined) return true
    const findAt = answer.kind === 'exists' ? at : answer.kind === 'saved' && settled ? 0 : row.findAt
    const done = settled && row.gen === gen && (findAt === 0 || answer.kind === 'saved')
    if (done) {
      yield* dropRow(topicId)
      return true
    }
    const { sending: _, ...rest } = row
    yield* writeRow({ ...rest, creating: false, findAt, attempts: 0 }, 0)
    return false
  })

/**
 * The call's answer was lost, or the call failed on the way: the row keeps its intent and is due again at
 * `nextAt`. Slack may have run the call, so its text stays Juno's own until a list after now, and a lost
 * create makes the next create wait for one. `ran` is false when Slack did not run it (a rate limit, no
 * session).
 */
export const deferDraftSave = (topicId: string, nextAt: number, error: string, at: number, ran: boolean): Writer =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const row = yield* pendingDraft(topicId)
    if (row === undefined) return
    const { sending, ...rest } = row
    const unsure = !ran || sending === undefined ? rest.unsure : [...rest.unsure.filter((text) => text !== sending), sending]
    const next = { ...rest, creating: false, unsure, unsureAt: ran && sending !== undefined ? at : rest.unsureAt, findAt: ran && row.creating ? at : rest.findAt }
    yield* sql`UPDATE outbox SET payload_json = ${payloadOf(next)}, attempts = attempts + 1, next_at = ${String(nextAt)}, last_error = ${error} WHERE kind = 'draft' AND target_key = ${topicId}`
  })

/** After a restart: a call that was out counts as one whose answer was lost. */
export const recoverDraftSaves = (at: number): Writer =>
  Effect.gen(function* () {
    for (const row of yield* pendingDrafts) if (row.sending !== undefined) yield* deferDraftSave(row.topicId, row.nextAt, 'restart', at, true)
  })

/** The topic is no place in Slack: the row ends and the draft stays in Juno only. */
export const dropDraftSave = (topicId: string): Writer => dropRow(topicId)

/**
 * Slack refused the call for generation `gen` for good: that text stays in Juno only, and still counts as a
 * local edit Slack has not acknowledged, so its row stays, sending nothing (`claimDraftSave`), and an older
 * version from Slack does not replace it. A newer change still goes, due at once.
 */
export const refuseDraftSave = (topicId: string, gen: number): Writer =>
  Effect.gen(function* () {
    const row = yield* pendingDraft(topicId)
    if (row === undefined) return
    const { sending: _, ...rest } = row
    yield* writeRow({ ...rest, creating: false, attempts: 0, refused: row.gen === gen ? gen : row.refused }, 0)
  })

/** Lists requested at `requestedAt` have shown what lost calls and lost creates left: their texts are no longer Juno's own. */
export const settleDraftFinds = (requestedAt: number): Writer =>
  Effect.gen(function* () {
    for (const row of yield* pendingDrafts) {
      const unsure = requestedAt > row.unsureAt ? [] : row.unsure
      const findAt = requestedAt > row.findAt ? 0 : row.findAt
      if (unsure.length !== row.unsure.length || findAt !== row.findAt) yield* writeRow({ ...row, unsure, findAt }, Math.min(row.nextAt, requestedAt))
    }
  })
