/**
 * `MessageBody` on the wire: the renderer-agnostic body `@juno/richtext`
 * builds from a Slack message (architecture 9), as a schema so a message
 * row can cross the port.
 *
 * The same shape exists twice: as richtext's TypeScript model, which the
 * engine builds, and here, which the route encodes. The contract may not
 * import richtext, so the engine checks at compile time that the two are
 * the same type (`packages/engine/src/messages/body.ts`); a change to one
 * without the other fails `bun run typecheck`.
 *
 * Every mention already carries a display name and every emoji a unicode
 * string or an image url, so a view draws a body without lookups.
 */
import { Schema } from 'effect'
import { ConversationKind } from '@juno/domain'

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
  // `unreachable`: Juno has nothing to open for them, an app with no DM or a user the store does not know (SPEC 7, "Messages").
  Schema.Struct({ kind: Schema.Literal('user'), id: Schema.String, name: Schema.String, isMe: Schema.Boolean, unreachable: Schema.optionalKey(Schema.Literal(true)) }),
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

/** A table column's settings; absent fields are Slack's defaults, left aligned on one line. */
export const BodyTableColumn = Schema.Struct({
  align: Schema.optionalKey(Schema.Literals(['center', 'right'])),
  wrap: Schema.optionalKey(Schema.Literal(true)),
})
export type BodyTableColumn = typeof BodyTableColumn.Type

const ContentBlock = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('paragraph'), children: Schema.Array(BodyInline) }),
  Schema.Struct({ kind: Schema.Literal('quote'), children: Schema.Array(BodyInline) }),
  // `text` is the code as written. When its first line is only a language tag, `language` is its highlight.js
  // grammar name and `tagLine` says the view leaves that line out (richtext's `codeBlock`).
  Schema.Struct({ kind: Schema.Literal('code'), text: Schema.String, language: Schema.optionalKey(Schema.String), tagLine: Schema.optionalKey(Schema.Literal(true)) }),
  Schema.Struct({
    kind: Schema.Literal('list'),
    style: BodyListStyle,
    indent: Schema.Number,
    items: Schema.Array(Schema.Array(BodyInline)),
  }),
  Schema.Struct({ kind: Schema.Literal('heading'), children: Schema.Array(BodyInline) }),
  Schema.Struct({ kind: Schema.Literal('divider') }),
  // `icons`: the context block's image elements, drawn small before its text; `alt` is for a screen reader.
  Schema.Struct({ kind: Schema.Literal('context'), children: Schema.Array(BodyInline), icons: Schema.optionalKey(Schema.Array(Schema.Struct({ url: Schema.String, alt: Schema.String }))) }),
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
  /**
   * A legacy attachment's buttons that go back to their app, in Slack's
   * order (`messages.attachmentAction`). `attachment` is the attachment's id
   * and each `id` the button's; `confirm` is Slack's question before sending.
   */
  Schema.Struct({
    kind: Schema.Literal('buttons'),
    attachment: Schema.String,
    items: Schema.Array(Schema.Struct({
      id: Schema.String,
      text: Schema.String,
      style: Schema.optionalKey(Schema.Literals(['primary', 'danger'])),
      confirm: Schema.optionalKey(Schema.Struct({ title: Schema.optionalKey(Schema.String), text: Schema.String, ok: Schema.String, dismiss: Schema.String })),
    })),
  }),
  /**
   * A Slack table: rows of cells of the same length, each cell a run of
   * inlines, the first row its header. `columns` holds Slack's settings by
   * column index; `caption` names the table, shown above it with `showCaption`.
   */
  Schema.Struct({
    kind: Schema.Literal('table'),
    rows: Schema.Array(Schema.Array(Schema.Array(BodyInline))),
    columns: Schema.optionalKey(Schema.Array(BodyTableColumn)),
    caption: Schema.optionalKey(Schema.String),
    showCaption: Schema.optionalKey(Schema.Literal(true)),
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
    /**
     * Where a shared Slack message was posted, when Juno knows the place: its
     * kind, its name (a channel's without "#", a DM's people), its permalink,
     * and whether it was a reply. With it, `footer` holds only the date.
     */
    source: Schema.optionalKey(Schema.Struct({ kind: ConversationKind, name: Schema.String, url: Schema.String, thread: Schema.Boolean })),
    footer: Schema.Array(BodyInline),
  }),
])
export type BodyBlock = typeof BodyBlock.Type

export const MessageBody = Schema.Struct({ blocks: Schema.Array(BodyBlock) })
export type MessageBody = typeof MessageBody.Type

/**
 * Rows of a table body as tab-separated lines, as `plainText` writes a whole
 * table: the view copies the rows a selection covers with it. A
 * `@juno/richtext` rule, reached through `@juno/domain` because views do not
 * import either.
 */
export { tableText } from '@juno/domain'
