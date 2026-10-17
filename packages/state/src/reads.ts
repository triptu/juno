/**
 * Read state for the topic view (owner decision 10-13; architecture 5.6).
 *
 * `shouldMarkRead` is the read rule. Opening a topic marks it read. After
 * that, messages are marked read only while the tab is active, the window
 * is focused and the list is at the bottom; messages that arrive while the
 * user is scrolled up stay unread until they reach the bottom. A topic
 * marked unread while it is shown stays unread: the bottom no longer marks
 * it read until the tab shows it again (SPEC 7, "Mark as unread").
 *
 * The commands are run with `runCommand(registry, readsMarkRead, { id, upTo })`
 * and `readsMarkUnread`; each returns the undo the engine computed.
 * `mirrorReadsAtom` is the setting that lets marks reach Slack; change it
 * with `prefs.set { key: MIRROR_READS_PREF, value }`.
 */
import { readsMirror, readsCatchUpStatus } from '@juno/contract'
import { liveQuery } from './atoms'

/** What happened in a topic tab. */
export type ReadTrigger =
  /** The tab opened or became the shown topic. */
  | 'open'
  /** The list reached the bottom, or a message arrived while it was there. */
  | 'bottom'

export interface ReadView {
  /** The tab is the active one. */
  readonly active: boolean
  /** The app window has focus. */
  readonly focused: boolean
  /** The message list is scrolled to the bottom. */
  readonly atBottom: boolean
  /** The topic was marked unread and has not been marked read since. */
  readonly markedUnread: boolean
}

/** Whether `trigger` in a tab in state `view` marks the topic read. */
export function shouldMarkRead(trigger: ReadTrigger, view: ReadView): boolean {
  if (trigger === 'open') return true
  return view.active && view.focused && view.atBottom && !view.markedUnread
}

/** The mirror setting of the open workspace: `{ on, explicit }`. */
export const mirrorReadsAtom = liveQuery(readsMirror)(undefined)

export const readCatchUpAtom = liveQuery(readsCatchUpStatus)(undefined)
