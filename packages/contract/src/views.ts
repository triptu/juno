/**
 * A sidebar view as stored (spec section 5, "Views"). It lives here, apart
 * from the views routes, because the topics routes' `UndoCommand` carries
 * one too: deleting a view returns it whole, so Undo puts it back as it was.
 */
import { Schema } from 'effect'
import { ViewColor, ViewIcon } from '@juno/domain'

export { ViewColor, ViewIcon }

export const SavedView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: Schema.optionalKey(ViewIcon),
  /** The icon's colour; absent is neutral. */
  color: Schema.optionalKey(ViewColor),
  /** The view's conversations show only in it: never in All, Channels or DMs. */
  keepOutOfAll: Schema.Boolean,
  /** Channel and DM ids. */
  channels: Schema.Array(Schema.String),
  /** Its place in the pill row, from 0. */
  position: Schema.Int,
})
export type SavedView = typeof SavedView.Type

/**
 * Where a conversation goes when the user answers about the Automated view
 * (SPEC section 5, "Automated"): into it, kept where it is (Keep in All), or
 * back to an open question on Home, which is only the undo of an answer.
 */
export const AutomatedPlace = Schema.Literals(['automated', 'kept', 'ask'])
export type AutomatedPlace = typeof AutomatedPlace.Type
