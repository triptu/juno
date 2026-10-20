/**
 * The media viewer open in each topic view (spec section 8, "Images and the
 * media viewer"). Kept here, not in the topic's component, so a tab that
 * unmounts (it left the five kept mounted, or Back moved off its topic)
 * shows the viewer again at the same item when its topic comes back.
 */
import * as Atom from 'effect/reactivity/Atom'
import type { FileView } from '@juno/contract'

/** A message's files open in the viewer: its pictures, and audio, PDF, HTML and text files. */
interface OpenViewer {
  readonly items: ReadonlyArray<FileView>
  /** The item shown. */
  readonly index: number
  /** The message's sender, as the message shows it. */
  readonly sender: string
  /** When the message was sent, epoch millis. */
  readonly at: number
  /** When the viewer opened: the time in its header is reckoned from it. */
  readonly now: number
}

/**
 * Each topic view's open viewer, kept while the app runs. Keyed by
 * `topicView(topicId, tabId)`, so two tabs on one topic keep their own.
 */
export const openViewerAtom = Atom.family((_view: string) => Atom.make<OpenViewer | undefined>(undefined).pipe(Atom.keepAlive))
