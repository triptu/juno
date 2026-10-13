/**
 * Read state (spec section 7, architecture 5.6, specs/readstate.qnt).
 *
 * Commands change Juno's read pointer at once, in one transaction with the
 * topic's index row, so the sidebar count changes with the mark. When the
 * mirror setting is on, the mark then goes to Slack in the background
 * (`conversations.mark` for Main, `subscriptions.thread.mark` for a followed
 * thread; an unfollowed thread stays local). A failed mirror never fails the
 * command: the outbox retries it, and Slack's answer settles the pointer.
 * Both commands return the undo the engine computed (ADR 0010).
 *
 * Nothing else marks: opening a topic, a live query and the sync never do.
 * The renderer calls `reads.markRead` by the read rule (`shouldMarkRead` in
 * `@juno/state`), so a stealth tab marks only from its Mark read button.
 *
 * `reads.mirror` is the setting that lets marks reach Slack, as it applies
 * to the open workspace. It is the workspace preference `MIRROR_READS_PREF`,
 * written with `prefs.set { key: 'reads.mirror', value: true | false }`.
 * Unset, it is on against the fake Slack and off against a real workspace.
 * Turning it off drops marks that have not been sent yet.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotFound, NotSignedIn } from '../errors'
import { liveValueRoute } from '../live'
import { CommandResult } from './topics'

/** Why a mark did not happen: no workspace is open, or the id is not a topic the store knows. */
export const ReadError = Schema.Union([NotSignedIn, NotFound])
export type ReadError = typeof ReadError.Type

/**
 * Marks a topic read up to `upTo` (a message ts), or to its latest message.
 * The pointer never moves back; a topic already read there returns no undo.
 */
export const readsMarkRead = Rpc.make('reads.markRead', {
  payload: { id: Schema.String, upTo: Schema.optionalKey(Schema.String) },
  success: CommandResult,
  error: ReadError,
})

/**
 * Marks a topic unread from `from` (a message ts), or from its latest
 * message: that message and everything after it count as unread, and the
 * topic shows at least one unread until it is read again.
 */
export const readsMarkUnread = Rpc.make('reads.markUnread', {
  payload: { id: Schema.String, from: Schema.optionalKey(Schema.String) },
  success: CommandResult,
  error: ReadError,
})

export const MirrorSetting = Schema.Struct({
  /** Marks reach Slack. */
  on: Schema.Boolean,
  /** The user chose it; otherwise it is the default for this workspace. */
  explicit: Schema.Boolean,
})
export type MirrorSetting = typeof MirrorSetting.Type

/** The workspace preference key of the mirror setting: a JSON boolean, or unset for the default. */
export const MIRROR_READS_PREF = 'reads.mirror'

/** The mirror setting of the open workspace, with its default applied. Sends nothing while no workspace is open. */
export const readsMirror = liveValueRoute('reads.mirror', { value: MirrorSetting })

export const ReadsRoutes = RpcGroup.make(readsMarkRead, readsMarkUnread, readsMirror)
