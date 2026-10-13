/**
 * Read state for the topic view (owner decision 10-13; architecture 5.6).
 *
 * `shouldMarkRead` is the read rule. Opening a topic marks it read. After
 * that, messages are marked read only while the tab is active, the window
 * is focused and the list is at the bottom; messages that arrive while the
 * user is scrolled up stay unread until they reach the bottom. A stealth
 * tab never marks: only its Mark read button does, and that ends stealth.
 *
 * The commands are run with `runCommand(registry, readsMarkRead, { id, upTo })`
 * and `readsMarkUnread`; each returns the undo the engine computed.
 * `mirrorReadsAtom` is the setting that lets marks reach Slack; change it
 * with `prefs.set { key: MIRROR_READS_PREF, value }`.
 */
import { readsMirror } from '@juno/contract'
import { liveQuery } from './atoms'

/** What happened in a topic tab. */
export type ReadTrigger =
  /** The tab opened or became the shown topic. */
  | 'open'
  /** The list reached the bottom, or a message arrived while it was there. */
  | 'bottom'
  /** The stealth pill's Mark read. */
  | 'mark-read'

export interface ReadView {
  readonly stealth: boolean
  /** The tab is the active one. */
  readonly active: boolean
  /** The app window has focus. */
  readonly focused: boolean
  /** The message list is scrolled to the bottom. */
  readonly atBottom: boolean
}

/** Whether `trigger` in a tab in state `view` marks the topic read. */
export function shouldMarkRead(trigger: ReadTrigger, view: ReadView): boolean {
  if (trigger === 'mark-read') return true
  if (view.stealth) return false
  if (trigger === 'open') return true
  return view.active && view.focused && view.atBottom
}

/** The mirror setting of the open workspace: `{ on, explicit }`. */
export const mirrorReadsAtom = liveQuery(readsMirror)(undefined)
