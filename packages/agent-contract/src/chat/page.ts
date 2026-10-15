/**
 * The chat page and the small summary the sidebar and the home read.
 */
import { Schema } from 'effect'
import { ChatItem } from './items'

/**
 * The one thing the chat header can say about Juno as a whole. The
 * conditions are not exclusive (paused and offline can both hold), so the
 * container picks one by precedence, highest first:
 *
 *   otherDevice > updateNeeded > recovery > aiOff > paused > offline > none
 *
 * Each has `chip` and `line` copy in `chatCopy.banner`. `none` is the
 * common case.
 *
 * - `otherDevice`: another Mac owns Juno. The chat is read-only.
 * - `updateNeeded`: the journal is newer than this build (plan v3 §3 step
 *   6). Nothing runs until Juno is updated; the composer is disabled.
 * - `recovery`: restored from backup. The composer works and sends wait
 *   for the review; Review opens the `review` page.
 * - `aiOff`: AI assist is off in Settings. The composer is disabled.
 * - `paused`: the owner paused Juno. The composer works and sends wait
 *   until Resume.
 * - `offline`: no network. The composer works; a send that needs the
 *   network waits.
 */
export const Banner = Schema.Union([
  Schema.TaggedStruct('none', {}),
  Schema.TaggedStruct('paused', {}),
  Schema.TaggedStruct('aiOff', {}),
  Schema.TaggedStruct('offline', {}),
  Schema.TaggedStruct('recovery', { pending: Schema.Int }),
  Schema.TaggedStruct('updateNeeded', {}),
  Schema.TaggedStruct('otherDevice', { deviceName: Schema.String }),
])
export type Banner = typeof Banner.Type

export const ChatPage = Schema.Struct({
  items: Schema.Array(ChatItem),
  banner: Banner,
  /**
   * There are more items outside the window. The list asks for them when
   * the owner scrolls towards an edge; a 5,000-message chat is never sent
   * whole, and a window opened at the "New" divider has items on both sides.
   */
  moreAbove: Schema.Boolean,
  moreBelow: Schema.Boolean,
  /** The composer's draft is the renderer's. This is only whether it takes input. */
  composerEnabled: Schema.Boolean,
})
export type ChatPage = typeof ChatPage.Type

/**
 * What the rest of the app shows about Juno: the sidebar's Juno row, the
 * nav count and the home's Ask Juno field. One live query feeds all three.
 */
export const ChatSummary = Schema.Struct({
  mayAuthorize: Schema.optionalKey(Schema.Boolean),
  /** Unread Juno messages. A soft grey count, never an accent badge. */
  unread: Schema.Int,
  /** A background job is running: the duotone sparkle. A run alone does not light it (SPEC §13.2). */
  busy: Schema.Boolean,
  /**
   * The newest running job's state line ("T3 Code · tests running, 2 of 5").
   * The home's Ask Juno field shows it in place of the placeholder, as a
   * text swap with no reflow.
   */
  jobLine: Schema.optionalKey(Schema.String),
})
export type ChatSummary = typeof ChatSummary.Type
