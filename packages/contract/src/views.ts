/**
 * A sidebar view as stored (spec section 5, "Views"). It lives here, apart
 * from the views routes, because the topics routes' `UndoCommand` carries
 * one too: deleting a view returns it whole, so Undo puts it back as it was.
 */
import { Schema } from 'effect'
import { ViewIcon, VIEW_ICONS } from '@juno/domain'

export { ViewIcon, VIEW_ICONS }

export const SavedView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: Schema.optionalKey(ViewIcon),
  /** The view's conversations show only in it: never in All, Channels or DMs. */
  keepOutOfAll: Schema.Boolean,
  /** Channel and DM ids. */
  channels: Schema.Array(Schema.String),
  /** Its place in the pill row, from 0. */
  position: Schema.Int,
})
export type SavedView = typeof SavedView.Type
