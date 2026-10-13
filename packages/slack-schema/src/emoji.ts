import { Schema } from 'effect'

/** Edge emoji fields referenced by the client bundle; the full live shape is still unknown. */
export const CustomEmoji = Schema.Struct({
  name: Schema.String,
  url: Schema.optionalKey(Schema.NullOr(Schema.String)),
  alias_for: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
export type CustomEmoji = typeof CustomEmoji.Type
export const EdgeEmojisListOk = Schema.Struct({
  ok: Schema.Literal(true), results: Schema.Array(CustomEmoji), next_marker: Schema.optionalKey(Schema.String),
})
