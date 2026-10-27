import { GONE_KEPT, type SlackDraft } from '@juno/domain'
import { StoreWriter, type SqlError } from '@juno/store'
import { Effect } from 'effect'
import type { Writer } from './shared'
import { draftSyncRow, dropRow, emptyRow, observeDraft, payloadOf, pendingDraft, pendingDrafts, writeRow, writeSync, type DraftSyncRow, type Services } from './drafts'

// The sender's side of a topic's `draft` row (`drafts.ts`, specs/drafts.qnt): a call going out, its answer,
// a lost answer, and what a list settles.

/** The call a claimed row makes, with what it sends, read in the transaction that claimed it. */
export interface DraftClaim {
  readonly op: 'create' | 'update' | 'clear' | 'delete'
  readonly gen: number
  /** The text it saves; `''` for a delete or a clear. */
  readonly text: string
  /** The local edit's time, sent as `client_last_updated_ts`. */
  readonly editedAt: number
  readonly slackId?: string
  readonly fileIds: ReadonlyArray<string>
  readonly clientMsgId?: string
}

/**
 * Reads the topic's row and claims it for one call, in one transaction (run it in one): what the stored
 * draft needs now, marked as sending so its echo is known. Nothing is claimed when the row is gone or not
 * due, when a create must wait for a list to find the place's draft (the list makes the row due again), or
 * when nothing is owed (no text change, or one Slack refused for good): the row then waits for sent drafts'
 * posts, or ends. A caller that gets no claim
 * sends nothing. `fresh` makes the `client_msg_id` of a first create; `now` is Juno's clock.
 */
export const claimDraftSave = (topicId: string, now: number, retryMillis: number, fresh: () => string): Effect.Effect<DraftClaim | undefined, SqlError, Services> =>
  Effect.gen(function* () {
    const sql = yield* StoreWriter
    const state = yield* draftSyncRow(topicId)
    const row = state.row
    if (row === undefined || row.nextAt > now) return undefined
    const op = row.refused === row.gen ? undefined : state.text !== '' ? (state.slackId !== undefined ? 'update' : 'create') : state.slackId === undefined ? undefined : state.fileIds.length > 0 ? 'clear' : 'delete'
    if (op === undefined || (op === 'create' && row.findAt > 0)) {
      // A refused text stays a local edit: its row waits, so an older version from Slack does not replace it.
      const later = row.findAt > 0 ? Number.MAX_SAFE_INTEGER : row.sent.length > 0 ? now + retryMillis : row.refused === row.gen ? Number.MAX_SAFE_INTEGER : undefined
      if (later === undefined) yield* dropRow(topicId)
      else yield* sql`UPDATE outbox SET next_at = ${String(later)} WHERE kind = 'draft' AND target_key = ${topicId}`
      return undefined
    }
    const clientMsgId = op === 'create' ? (state.clientMsgId ?? fresh()) : undefined
    if (clientMsgId !== undefined && state.clientMsgId === undefined) yield* writeSync({ ...state, clientMsgId })
    const text = op === 'update' || op === 'create' ? state.text : ''
    yield* writeRow({ ...row, sending: text, creating: op === 'create' }, row.nextAt)
    return {
      op,
      gen: row.gen,
      text,
      // A draft with no time of its own (from before the clear time was kept) goes with now.
      editedAt: state.editedAt > 0 ? state.editedAt : now,
      ...(state.slackId === undefined ? {} : { slackId: state.slackId }),
      fileIds: state.fileIds,
      ...(clientMsgId === undefined ? {} : { clientMsgId }),
    }
  })

/** What Slack answered a draft call. */
export type DraftAnswer =
  | { readonly kind: 'saved'; readonly id: string; readonly stamp: number; readonly fileIds: ReadonlyArray<string>; readonly clientMsgId?: string | undefined; readonly text: string }
  /** `attached_draft_exists`: the place has a draft Juno does not link. */
  | { readonly kind: 'exists' }
  /** The update named a draft Slack no longer has live (deleted or sent elsewhere). */
  | { readonly kind: 'gone'; readonly id: string }
  /** The draft named is deleted (also when Slack no longer had it). */
  | { readonly kind: 'deleted'; readonly id: string }

/**
 * Slack answered the call for generation `gen` at `at` (Juno's clock). A save links its draft, unless Juno
 * saw it deleted since (the text then goes again), linked a newer one since, or its text went as a message
 * since (Juno then deletes it, once sure it holds only Juno's text); its files and stamp count only
 * when it is newer than what Juno has seen of that draft, since a version that came after it (another
 * device's files) may have applied before a slow answer. The row ends when no newer change replaced its
 * intent and nothing else is owed; otherwise it is due again at once. Returns whether it ended.
 */
export const endDraftSave = (topicId: string, gen: number, answer: DraftAnswer, at: number): Effect.Effect<boolean, SqlError, Services> =>
  Effect.gen(function* () {
    const before = yield* draftSyncRow(topicId)
    const row = before.row
    let state: DraftSyncRow = before
    let settled = true
    let cleanup: string | undefined
    switch (answer.kind) {
      case 'saved': {
        const goneSave = before.gone.includes(answer.id)
        const sentAs = before.slackId === answer.id ? undefined : before.sent.find((each) => each.id === answer.id || (answer.clientMsgId !== undefined && each.clientMsgId === answer.clientMsgId))
        // The answer is older than what Juno knows: of a draft it no longer links, or of the one it links.
        const older = before.slackId !== undefined && (before.slackId === answer.id ? answer.stamp <= (before.slackStamp ?? 0) : answer.stamp < (before.slackStamp ?? 0))
        if (goneSave) settled = false
        else if (sentAs !== undefined) {
          state = { ...before, sent: before.sent.map((each) => (each === sentAs ? { ...each, id: answer.id } : each)) }
          cleanup = answer.id
        } else if (!older) {
          state = {
            ...before,
            slackId: answer.id,
            seenAt: answer.id === before.slackId && before.seenAt !== undefined ? before.seenAt : at,
            slackStamp: Math.max(before.slackStamp ?? 0, answer.stamp),
            slackText: answer.text,
            fileIds: answer.fileIds,
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
        state = { ...(before.slackId === answer.id ? unlinked : before), gone: [...before.gone.filter((id) => id !== answer.id), answer.id].slice(-GONE_KEPT) }
        // A delete covers the draft it named; one linked meanwhile still needs its own.
        if (answer.kind === 'gone' || (before.slackId !== undefined && before.slackId !== answer.id)) settled = false
        break
      }
    }
    yield* writeSync(state)
    const owed = row ?? (cleanup === undefined ? undefined : { ...emptyRow(topicId, at), gen: 1, resave: true })
    if (owed === undefined) return true
    const sent = cleanup === undefined || owed.sent.some((each) => each.id === cleanup) ? owed.sent : [...owed.sent, { id: cleanup, after: '', named: false }]
    const findAt = answer.kind === 'exists' ? at : answer.kind === 'saved' && settled ? 0 : owed.findAt
    const done = settled && owed.gen === gen && sent.length === 0 && (findAt === 0 || answer.kind === 'saved')
    if (done) {
      yield* dropRow(topicId)
      return true
    }
    const { sending: _, ...rest } = owed
    yield* writeRow({ ...rest, sent, creating: false, findAt, attempts: 0 }, 0)
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
 * version from Slack does not replace it. A newer change still goes (due at once), and sent drafts still
 * wait to be deleted.
 */
export const refuseDraftSave = (topicId: string, gen: number): Writer =>
  Effect.gen(function* () {
    const row = yield* pendingDraft(topicId)
    if (row === undefined) return
    const { sending: _, ...rest } = row
    yield* writeRow({ ...rest, creating: false, attempts: 0, refused: row.gen === gen ? gen : row.refused }, 0)
  })

/**
 * A sent draft is gone from Slack: its post landed (Slack retired it), Juno deleted it, or Slack has it deleted
 * or sent. It leaves the row, which the sender looks at again, and nothing of it can come back.
 */
export const endSentDraft = (topicId: string, slackId: string): Writer =>
  Effect.gen(function* () {
    const row = yield* pendingDraft(topicId)
    if (row !== undefined) yield* writeRow({ ...row, sent: row.sent.filter((each) => each.id !== slackId) }, 0)
    const state = yield* draftSyncRow(topicId)
    yield* writeSync({ ...state, gone: [...state.gone.filter((id) => id !== slackId), slackId].slice(-GONE_KEPT), sent: state.sent.filter((each) => each.id !== slackId) })
  })

/**
 * Before Juno deletes a draft whose text went as a message: Slack's current version of it (`drafts.info`).
 * Slack has no conditional delete, so Juno looks first and leaves a draft it is unsure of. Returns true when
 * the draft still holds only Juno's text and no files, and the delete may go. Otherwise its delete is off:
 * with Juno's text and files another device added it is linked again and its text cleared; with another text
 * it is the place's draft, by the rule (or, under newer local typing, kept for ⌘Z).
 */
export const checkSentDraft = (
  topicId: string,
  slack: SlackDraft & { readonly fileIds: ReadonlyArray<string> },
  how: { readonly seenAt: number; readonly same: (a: string, b: string) => boolean },
): Effect.Effect<boolean, SqlError, Services> =>
  Effect.gen(function* () {
    const before = yield* draftSyncRow(topicId)
    const sentAs = before.sent.find((each) => each.id === slack.id || (slack.clientMsgId !== undefined && each.clientMsgId === slack.clientMsgId))
    const ours = sentAs !== undefined && sentAs.texts.some((text) => how.same(text, slack.text))
    if (ours && slack.fileIds.length === 0) return true
    const row = before.row
    if (row !== undefined) yield* writeRow({ ...row, sent: row.sent.filter((each) => each.id !== slack.id) }, 0)
    const kept = { ...(yield* draftSyncRow(topicId)), gone: before.gone.filter((id) => id !== slack.id) }
    if (!ours) {
      yield* writeSync(kept)
      yield* observeDraft(topicId, slack, how)
      return false
    }
    // Juno's text, with files: the files stay, and Juno's empty text goes over it.
    const relink = kept.slackId === undefined || kept.slackId === slack.id
    yield* writeSync(relink ? { ...kept, slackId: slack.id, seenAt: how.seenAt, slackStamp: Math.max(kept.slackStamp ?? 0, slack.stamp), slackText: slack.text, fileIds: slack.fileIds } : kept)
    if (relink) {
      const owed = (yield* pendingDraft(topicId)) ?? emptyRow(topicId, how.seenAt)
      yield* writeRow({ ...owed, gen: owed.gen + 1, resave: false }, how.seenAt)
    }
    return false
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
