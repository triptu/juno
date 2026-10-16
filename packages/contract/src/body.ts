/**
 * `MessageBody` on the wire: the renderer-agnostic body `@juno/richtext`
 * builds from a Slack message (architecture 9), as a schema so a message
 * row can cross the port.
 *
 * The same shape exists twice: as richtext's TypeScript model, which the
 * engine builds, and here, which the route encodes. The contract may not
 * import richtext, so the engine checks at compile time that the two are
 * the same type (`packages/engine/src/messages/body.ts`); a change to one
 * without the other fails `pnpm typecheck`.
 *
 * Every mention already carries a display name and every emoji a unicode
 * string or an image url, so a view draws a body without lookups.
 */
import { Schema } from 'effect'

export const BodyInlineStyle = Schema.Struct({
  bold: Schema.optionalKey(Schema.Literal(true)),
  italic: Schema.optionalKey(Schema.Literal(true)),
  strike: Schema.optionalKey(Schema.Literal(true)),
  code: Schema.optionalKey(Schema.Literal(true)),
})
export type BodyInlineStyle = typeof BodyInlineStyle.Type

export const BroadcastRange = Schema.Literals(['here', 'channel', 'everyone'])
export type BroadcastRange = typeof BroadcastRange.Type

export const BodyInline = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('text'), text: Schema.String, style: Schema.optionalKey(BodyInlineStyle) }),
  Schema.Struct({ kind: Schema.Literal('link'), url: Schema.String, text: Schema.String, style: Schema.optionalKey(BodyInlineStyle) }),
  Schema.Struct({ kind: Schema.Literal('user'), id: Schema.String, name: Schema.String, isMe: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal('channel'), id: Schema.String, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('usergroup'), id: Schema.String, handle: Schema.String, name: Schema.optionalKey(Schema.String), isMine: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal('broadcast'), range: BroadcastRange }),
  Schema.Struct({
    kind: Schema.Literal('emoji'),
    name: Schema.String,
    unicode: Schema.optionalKey(Schema.String),
    url: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal('break') }),
  /**
   * A Slack `date` element (M4, WP2). `timestamp` is epoch seconds and
   * `format` Slack's token string ("{date_short} at {time}"); the view formats
   * it in the user's time zone. `fallback` is Slack's text for when it cannot.
   */
  Schema.Struct({
    kind: Schema.Literal('date'),
    timestamp: Schema.Number,
    format: Schema.String,
    fallback: Schema.String,
    url: Schema.optionalKey(Schema.String),
  }),
])
export type BodyInline = typeof BodyInline.Type

export const BodyListStyle = Schema.Literals(['bullet', 'ordered', 'checked', 'unchecked'])
export type BodyListStyle = typeof BodyListStyle.Type

const ContentBlock = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('paragraph'), children: Schema.Array(BodyInline) }),
  Schema.Struct({ kind: Schema.Literal('quote'), children: Schema.Array(BodyInline) }),
  Schema.Struct({ kind: Schema.Literal('code'), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal('list'),
    style: BodyListStyle,
    indent: Schema.Number,
    items: Schema.Array(Schema.Array(BodyInline)),
  }),
  Schema.Struct({ kind: Schema.Literal('heading'), children: Schema.Array(BodyInline) }),
  Schema.Struct({ kind: Schema.Literal('divider') }),
  Schema.Struct({ kind: Schema.Literal('context'), children: Schema.Array(BodyInline) }),
  Schema.Struct({ kind: Schema.Literal('fields'), items: Schema.Array(Schema.Array(BodyInline)) }),
  Schema.Struct({ kind: Schema.Literal('image'), url: Schema.String, alt: Schema.String, width: Schema.optionalKey(Schema.Number), height: Schema.optionalKey(Schema.Number) }),
  /**
   * A file shared with the message (M4, WP2), in the order Slack lists them.
   * The thumbnail and the rest of what the file card shows are in the
   * message's `files` (`FileView`), matched by `id`.
   */
  Schema.Struct({
    kind: Schema.Literal('file'),
    id: Schema.String,
    name: Schema.String,
    mimetype: Schema.String,
    width: Schema.optionalKey(Schema.Number),
    height: Schema.optionalKey(Schema.Number),
  }),
])
export const BodyBlock = Schema.Union([
  ContentBlock,
  Schema.Struct({
    kind: Schema.Literal('attachment'),
    author: Schema.optionalKey(Schema.Struct({ name: Schema.String, icon: Schema.optionalKey(Schema.String) })),
    footerIcon: Schema.optionalKey(Schema.String),
    tint: Schema.Literals(['neutral', 'info', 'success', 'warning', 'danger']),
    title: Schema.Array(BodyInline),
    blocks: Schema.Array(ContentBlock),
    footer: Schema.Array(BodyInline),
  }),
])
export type BodyBlock = typeof BodyBlock.Type

export const MessageBody = Schema.Struct({ blocks: Schema.Array(BodyBlock) })
export type MessageBody = typeof MessageBody.Type
