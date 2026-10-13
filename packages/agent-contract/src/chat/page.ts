/**
 * The chat page and the small summary the sidebar and the home read.
 */
import { Schema } from 'effect'
import { ChatItem } from './items'

/**
 * The one thing the chat header can say about Juno as a whole. These are
 * exclusive, so one union and not five booleans. Each has fixed copy in
 * `chatCopy.banner`. `none` is the common case.
 *
 * - `paused`: the owner paused Juno. The composer works and sends queue
 *   until Resume.
 * - `aiOff`: AI assist is off in Settings. The composer is disabled.
 * - `offline`: no network. The composer works; a send that needs the
 *   network ends as Not delivered.
 * - `recovery`: restored from backup. Juno will not act until pending
 *   actions are reviewed.
 * - `otherDevice`: another Mac owns Juno. The chat is read-only.
 */
export const Banner = Schema.Union([
  Schema.TaggedStruct('none', {}),
  Schema.TaggedStruct('paused', {}),
  Schema.TaggedStruct('aiOff', {}),
  Schema.TaggedStruct('offline', {}),
  Schema.TaggedStruct('recovery', { pending: Schema.Int }),
  Schema.TaggedStruct('otherDevice', { deviceName: Schema.String }),
])
export type Banner = typeof Banner.Type

export const ChatPage = Schema.Struct({
  items: Schema.Array(ChatItem),
  banner: Banner,
  /**
   * There are more items above the window. The list asks for them when the
   * owner scrolls up; a 5,000-message chat is never sent whole.
   */
  moreAbove: Schema.Boolean,
  /** The composer's draft is the renderer's. This is only whether it takes input. */
  composerEnabled: Schema.Boolean,
})
export type ChatPage = typeof ChatPage.Type

/**
 * What the rest of the app shows about Juno: the sidebar's Juno row, the
 * nav count and the home's Ask Juno field. One live query feeds all three.
 */
export const ChatSummary = Schema.Struct({
  /** Unread Juno messages. A soft grey count, never an accent badge. */
  unread: Schema.Int,
  /** A run or a background job is active: the duotone sparkle. */
  busy: Schema.Boolean,
  /**
   * The newest running job's state line ("T3 Code · tests running, 2 of 5").
   * The home's Ask Juno field shows it in place of the placeholder, as a
   * text swap with no reflow.
   */
  jobLine: Schema.optionalKey(Schema.String),
})
export type ChatSummary = typeof ChatSummary.Type
