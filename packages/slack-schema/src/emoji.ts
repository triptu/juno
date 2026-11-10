import { Schema } from 'effect'
import { Ts } from './ts.ts'

/**
 * One edge `emojis/list` result, as observed live on 2026-10-16 (research
 * section 3). `value` is the image url, `alias:<name>` for an alias, or an
 * object of per-vendor image urls (`apple`, `google`). An alias also carries
 * `alias` (the target name) and `is_alias`. The target can be a standard
 * emoji, not only a custom one.
 */
export const CustomEmoji = Schema.Struct({
  name: Schema.String,
  value: Schema.optionalKey(Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
  alias: Schema.optionalKey(Schema.String),
  is_alias: Schema.optionalKey(Schema.Boolean),
})
export type CustomEmoji = typeof CustomEmoji.Type
export const EdgeEmojisListOk = Schema.Struct({
  ok: Schema.Literal(true), results: Schema.Array(CustomEmoji), next_marker: Schema.optionalKey(Schema.String),
})

/**
 * The socket's word that a custom emoji was added (`name`, `value`), removed
 * (`names`) or renamed (`old_name`, `new_name`, `value`). `value` is as in an
 * `emojis/list` result. Shape from Slack's Events API reference; not yet
 * observed on the client socket.
 */
export const EmojiChangedEvent = Schema.Struct({
  type: Schema.Literal('emoji_changed'),
  subtype: Schema.String,
  name: Schema.optionalKey(Schema.String),
  names: Schema.optionalKey(Schema.Array(Schema.String)),
  old_name: Schema.optionalKey(Schema.String),
  new_name: Schema.optionalKey(Schema.String),
  value: CustomEmoji.fields.value,
  event_ts: Schema.optionalKey(Ts),
})
export type EmojiChangedEvent = typeof EmojiChangedEvent.Type

const ALIAS_PREFIX = 'alias:'

/** The image url and alias target of one result, the way the `emoji` table stores them. */
export function customEmojiRow(emoji: CustomEmoji): { readonly name: string; readonly url: string | null; readonly alias_for: string | null } {
  const value = emoji.value
  const aliasFromValue = typeof value === 'string' && value.startsWith(ALIAS_PREFIX) ? value.slice(ALIAS_PREFIX.length) : undefined
  const url = typeof value === 'string' ? (aliasFromValue === undefined ? value : null) : (value?.['apple'] ?? value?.['google'] ?? Object.values(value ?? {})[0] ?? null)
  const aliasFor = aliasFromValue ?? (emoji.is_alias === true || url === null ? (emoji.alias ?? null) : null)
  return { name: emoji.name, url, alias_for: aliasFor === '' ? null : aliasFor }
}
