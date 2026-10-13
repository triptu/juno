/**
 * Side tables for list routes (architecture 7, "People and channels in the
 * same update").
 *
 * Rows name people and channels by id. Their names, photos and colours
 * travel once per subscription in `ListDelta.refs`, in the same message as
 * the first row that names them, and again only when they change. A new
 * photo is then one small upsert instead of a new `rev` on every row the
 * person appears on, and a 300-row window does not repeat the same people
 * and channels on every row.
 */
import { Schema } from 'effect'
import { ChannelColor, ChannelIcon, ContextTint, ConversationKind } from '@juno/domain'

/** A person on a row or a message. `avatarUrl` is the Slack profile photo when there is one. */
export const Person = Schema.Struct({
  id: Schema.String,
  /** The display name. The raw id when the store does not know the user. */
  name: Schema.String,
  avatarUrl: Schema.optionalKey(Schema.String),
  /** The ui hue for the initials when there is no photo. */
  color: ChannelColor,
})
export type Person = typeof Person.Type

/** A channel as rows name it. `RowChannel` in `routes/topics.ts` is the same with the DM partner joined in. */
export const ChannelRef = Schema.Struct({
  id: Schema.String,
  kind: ConversationKind,
  /** "eng", "Maya Chen", "Maya, Leo": the text next to the icon, without "#". */
  name: Schema.String,
  /** "#eng", "Maya Chen": the text a toast or tab uses. */
  label: Schema.String,
  tint: ContextTint,
  /** The ui icon key for the channel tile and line three. DMs use the avatar instead. */
  icon: ChannelIcon,
  /** The ui hue for the tile, from the channel id until the user picks one. */
  color: ChannelColor,
  /** The other person in a DM, a `Person` in the same refs. */
  partnerId: Schema.optionalKey(Schema.String),
})
export type ChannelRef = typeof ChannelRef.Type

/**
 * The side tables of one `ListDelta`. Each entry is new to the subscription
 * or changed since it was last sent; the renderer upserts them by id before
 * it applies the rows of the same message.
 */
export const Refs = Schema.Struct({
  people: Schema.optionalKey(Schema.Array(Person)),
  channels: Schema.optionalKey(Schema.Array(ChannelRef)),
})
export type Refs = typeof Refs.Type
