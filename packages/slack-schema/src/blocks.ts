/**
 * Message `blocks`. `rich_text` is what the official client sends and renders,
 * so it is modelled in full, as is `table`, whose cells are `rich_text`.
 * Bots use `section`, `context`, `header`, `image` and `divider`, modelled
 * minimally. Anything else decodes to the `unknown` variant with the raw
 * object kept, so rendering can show a placeholder and nothing is lost on a
 * round trip.
 *
 * Source: docs/research/slack-data-access.md section 5.
 */
import { Schema as S } from 'effect'
import { UnknownVariant } from './common.ts'

const opt = S.optionalKey

// Inline elements of a rich_text section, quote, header or preformatted block.

export const RichTextStyle = S.Struct({
  bold: opt(S.Boolean),
  italic: opt(S.Boolean),
  strike: opt(S.Boolean),
  code: opt(S.Boolean),
  highlight: opt(S.Boolean),
  client_highlight: opt(S.Boolean),
  unlink: opt(S.Boolean),
})
export type RichTextStyle = typeof RichTextStyle.Type

export const RichTextText = S.Struct({ type: S.Literal('text'), text: S.String, style: opt(RichTextStyle) })
export const RichTextUser = S.Struct({ type: S.Literal('user'), user_id: S.String, style: opt(RichTextStyle) })
export const RichTextUsergroup = S.Struct({
  type: S.Literal('usergroup'),
  usergroup_id: S.String,
  style: opt(RichTextStyle),
})
export const RichTextChannel = S.Struct({ type: S.Literal('channel'), channel_id: S.String, style: opt(RichTextStyle) })
export const RichTextBroadcast = S.Struct({
  type: S.Literal('broadcast'),
  range: S.Literals(['here', 'channel', 'everyone']),
  style: opt(RichTextStyle),
})
export const RichTextEmoji = S.Struct({
  type: S.Literal('emoji'),
  name: S.String,
  unicode: opt(S.String),
  skin_tone: opt(S.Number),
  style: opt(RichTextStyle),
})
export const RichTextLink = S.Struct({
  type: S.Literal('link'),
  url: S.String,
  text: opt(S.String),
  unsafe: opt(S.Boolean),
  style: opt(RichTextStyle),
})
export const RichTextDate = S.Struct({
  type: S.Literal('date'),
  timestamp: S.Number,
  format: S.String,
  url: opt(S.String),
  fallback: opt(S.String),
  style: opt(RichTextStyle),
})
export const RichTextColor = S.Struct({ type: S.Literal('color'), value: S.String })

/** Known inline elements first, then `unknown` for `workflowtoken`, `file`, `canvas`, `message_mention` and future types. */
export const RichTextInline = S.Union([
  RichTextText,
  RichTextUser,
  RichTextUsergroup,
  RichTextChannel,
  RichTextBroadcast,
  RichTextEmoji,
  RichTextLink,
  RichTextDate,
  RichTextColor,
  UnknownVariant,
])
export type RichTextInline = typeof RichTextInline.Type

// Block-level elements of a rich_text block.

export const RichTextSection = S.Struct({ type: S.Literal('rich_text_section'), elements: S.Array(RichTextInline) })
export const RichTextHeader = S.Struct({ type: S.Literal('rich_text_header'), elements: S.Array(RichTextInline) })
export const RichTextDivider = S.Struct({ type: S.Literal('rich_text_divider') })
export const RichTextQuote = S.Struct({
  type: S.Literal('rich_text_quote'),
  elements: S.Array(RichTextInline),
  border: opt(S.Number),
})
export const RichTextPreformatted = S.Struct({
  type: S.Literal('rich_text_preformatted'),
  elements: S.Array(RichTextInline),
  border: opt(S.Number),
})
export const RichTextListStyle = S.Literals(['bullet', 'ordered', 'check', 'checked', 'unchecked'])
export type RichTextListStyle = typeof RichTextListStyle.Type
export const RichTextList = S.Struct({
  type: S.Literal('rich_text_list'),
  style: RichTextListStyle,
  elements: S.Array(RichTextSection),
  indent: opt(S.Number),
  offset: opt(S.Number),
  border: opt(S.Number),
})
export type RichTextSection = typeof RichTextSection.Type
export type RichTextHeader = typeof RichTextHeader.Type
export type RichTextDivider = typeof RichTextDivider.Type
export type RichTextQuote = typeof RichTextQuote.Type
export type RichTextPreformatted = typeof RichTextPreformatted.Type
export type RichTextList = typeof RichTextList.Type

export const RichTextElement = S.Union([
  RichTextSection,
  RichTextHeader,
  RichTextDivider,
  RichTextQuote,
  RichTextPreformatted,
  RichTextList,
  UnknownVariant,
])
export type RichTextElement = typeof RichTextElement.Type

export const RichTextBlock = S.Struct({
  type: S.Literal('rich_text'),
  block_id: opt(S.String),
  elements: S.Array(RichTextElement),
})
export type RichTextBlock = typeof RichTextBlock.Type

// Layout blocks used by bots and apps.

export const TextObject = S.Struct({
  type: S.Literals(['mrkdwn', 'plain_text']),
  text: S.String,
  verbatim: opt(S.Boolean),
  emoji: opt(S.Boolean),
})
export type TextObject = typeof TextObject.Type

export const ImageElement = S.Struct({
  type: S.Literal('image'),
  image_url: opt(S.String),
  alt_text: S.String,
  slack_file: opt(S.Unknown),
})
export type ImageElement = typeof ImageElement.Type

export const SectionBlock = S.Struct({
  type: S.Literal('section'),
  block_id: opt(S.String),
  text: opt(TextObject),
  fields: opt(S.Array(TextObject)),
  accessory: opt(S.Unknown),
})
export const DividerBlock = S.Struct({ type: S.Literal('divider'), block_id: opt(S.String) })
export const HeaderBlock = S.Struct({ type: S.Literal('header'), block_id: opt(S.String), text: TextObject })
export const ContextBlock = S.Struct({
  type: S.Literal('context'),
  block_id: opt(S.String),
  elements: S.Array(S.Union([TextObject, ImageElement, UnknownVariant])),
})
export const ImageBlock = S.Struct({
  type: S.Literal('image'),
  block_id: opt(S.String),
  image_url: opt(S.String),
  alt_text: S.String,
  title: opt(TextObject),
  slack_file: opt(S.Unknown),
})

/**
 * A cell of a `table` block: a `rich_text` block (what recorded messages
 * carry), a `raw_text` or `raw_number` cell with plain `text`, or `null` for
 * an empty one. Anything else is `unknown`, so one odd cell keeps the table.
 */
export const TableRawCell = S.Struct({ type: S.Literals(['raw_text', 'raw_number']), text: S.String })
export const TableCell = S.Union([RichTextBlock, TableRawCell, S.Null, UnknownVariant])
export type TableCell = typeof TableCell.Type

/** One column's settings. `align` stays a string so a value Slack adds later keeps the table. */
export const TableColumnSetting = S.Struct({ align: opt(S.String), is_wrapped: opt(S.Boolean) })
export type TableColumnSetting = typeof TableColumnSetting.Type

/**
 * A table (research section 5, "Tables"). `rows` are arrays of cells; Slack's
 * client draws the first row as the header. `column_settings` is by column,
 * `null` for a column with the defaults. `caption` labels the table and shows
 * only with `is_caption_visible`.
 */
export const TableBlock = S.Struct({
  type: S.Literal('table'),
  block_id: opt(S.String),
  rows: S.Array(S.Array(TableCell)),
  column_settings: opt(S.Array(S.NullOr(TableColumnSetting))),
  caption: opt(S.String),
  is_caption_visible: opt(S.Boolean),
})

export type SectionBlock = typeof SectionBlock.Type
export type DividerBlock = typeof DividerBlock.Type
export type HeaderBlock = typeof HeaderBlock.Type
export type ContextBlock = typeof ContextBlock.Type
export type ImageBlock = typeof ImageBlock.Type
export type TableBlock = typeof TableBlock.Type

export const Block = S.Union([
  RichTextBlock,
  SectionBlock,
  DividerBlock,
  HeaderBlock,
  ContextBlock,
  ImageBlock,
  TableBlock,
  UnknownVariant,
])
export type Block = typeof Block.Type

export const Blocks = S.Array(Block)
export type Blocks = typeof Blocks.Type
