/** Slack `blocks` → `MessageBody`. `rich_text` is rendered faithfully; layout blocks get a plain rendering. */
import { Schema } from 'effect'
import { Block as SlackBlockSchema, type Block as SlackBlock, type RichTextElement, type RichTextInline, type RichTextListStyle, type TableBlock, type TableCell, type TableColumnSetting, type TextObject } from '@juno/slack-schema'
import type { ContentBlock as Block, Inline, ListStyle, Lookups, TableColumn } from './model'
import { channelInline, dateInline, emojiInline, inlineText, linkedRuns, normalize, textRuns, toStyle, usergroupInline, userInline } from './inline'
import { codeBlock } from './code'
import { mrkdwnBlocks, mrkdwnInlines } from './from-mrkdwn'

/**
 * The text an element kind we do not render carries, if any. Slack puts it in
 * `text` (`file`, `canvas`, `message_mention`, `workflowtoken`) or `fallback`.
 */
function unknownText(raw: Readonly<Record<string, unknown>>): string {
  return typeof raw.text === 'string' ? raw.text : typeof raw.fallback === 'string' ? raw.fallback : ''
}

function inlineFromElement(el: RichTextInline, lookups: Lookups): Inline[] {
  switch (el.type) {
    case 'text':
      return linkedRuns(el.text, toStyle(el.style))
    case 'user':
      return [userInline(el.user_id, lookups)]
    case 'channel':
      return [channelInline(el.channel_id, undefined, lookups)]
    case 'usergroup':
      return [usergroupInline(el.usergroup_id, undefined, lookups)]
    case 'broadcast':
      return [{ kind: 'broadcast', range: el.range }]
    case 'emoji': {
      const name = el.skin_tone !== undefined && !el.name.includes('::') ? `${el.name}::skin-tone-${el.skin_tone}` : el.name
      return [emojiInline(name, lookups, el.unicode)]
    }
    case 'link': {
      const style = toStyle(el.style)
      const text = el.text ?? el.url
      return [style ? { kind: 'link', url: el.url, text, style } : { kind: 'link', url: el.url, text }]
    }
    case 'date':
      return [dateInline(el.timestamp, el.format, el.fallback, el.url)]
    case 'color':
      return textRuns(el.value)
    case 'unknown':
      // Kinds we do not know. Keep their text so nothing the sender wrote is lost.
      return textRuns(unknownText(el.raw))
  }
}

function inlinesFromElements(elements: ReadonlyArray<RichTextInline>, lookups: Lookups): Inline[] {
  return normalize(elements.flatMap((el) => inlineFromElement(el, lookups)))
}

function listStyle(style: RichTextListStyle): ListStyle {
  switch (style) {
    case 'ordered':
      return 'ordered'
    case 'checked':
      return 'checked'
    case 'check':
    case 'unchecked':
      return 'unchecked'
    default:
      return 'bullet'
  }
}

function blockFromElement(el: RichTextElement, lookups: Lookups): Block | undefined {
  switch (el.type) {
    case 'rich_text_section': {
      const children = inlinesFromElements(el.elements, lookups)
      return children.length === 0 ? undefined : { kind: 'paragraph', children }
    }
    case 'rich_text_quote': {
      const children = inlinesFromElements(el.elements, lookups)
      return children.length === 0 ? undefined : { kind: 'quote', children }
    }
    case 'rich_text_preformatted': {
      // Code keeps its newlines and ignores styles.
      const text = inlineText(inlinesFromElements(el.elements, lookups))
      return text.length === 0 ? undefined : codeBlock(text)
    }
    case 'rich_text_list': {
      const items = el.elements.map((section) => inlinesFromElements(section.elements, lookups))
      return items.length === 0 ? undefined : { kind: 'list', style: listStyle(el.style), indent: el.indent ?? 0, items }
    }
    case 'rich_text_header': {
      const children = inlinesFromElements(el.elements, lookups)
      return children.length === 0 ? undefined : { kind: 'heading', children }
    }
    case 'rich_text_divider':
      return { kind: 'divider' }
    case 'unknown': {
      const children = normalize(textRuns(unknownText(el.raw)))
      return children.length === 0 ? undefined : { kind: 'paragraph', children }
    }
  }
}

function textObjectInlines(text: TextObject, lookups: Lookups): Inline[] {
  return text.type === 'mrkdwn' ? mrkdwnInlines(text.text, lookups) : normalize(textRuns(text.text))
}

function blocksFromMessageBlock(block: SlackBlock, lookups: Lookups): Block[] {
  switch (block.type) {
    case 'rich_text':
      return block.elements.flatMap((el) => {
        const b = blockFromElement(el, lookups)
        return b ? [b] : []
      })
    case 'section': {
      const out: Block[] = []
      if (block.text) out.push(...(block.text.type === 'mrkdwn' ? mrkdwnBlocks(block.text.text, lookups) : paragraphOf(textObjectInlines(block.text, lookups))))
      if (block.fields?.length) out.push({ kind: 'fields', items: block.fields.map((field) => textObjectInlines(field, lookups)) })
      if (block.accessory !== null && typeof block.accessory === 'object') out.push(...unknownBlocks(Object.fromEntries(Object.entries(block.accessory)), lookups))
      return out
    }
    case 'header': {
      const children = normalize(textRuns(block.text.text))
      return children.length === 0 ? [] : [{ kind: 'heading', children }]
    }
    case 'context': {
      const children: Inline[] = []
      for (const el of block.elements) {
        if (el.type === 'image') { children.push(...textRuns(el.alt_text)); continue }
        if (el.type === 'unknown') { children.push(...textRuns(unknownText(el.raw))); continue }
        if (children.length > 0) children.push({ kind: 'text', text: ' ' })
        children.push(...textObjectInlines(el, lookups))
      }
      return children.length ? [{ kind: 'context', children: normalize(children) }] : []
    }
    case 'divider':
      return [{ kind: 'divider' }]
    case 'image':
      return block.image_url ? [{ kind: 'image', url: block.image_url, alt: block.alt_text }] : paragraphOf(textRuns(block.alt_text))
    case 'table':
      return tableBlocks(block, lookups)
    case 'unknown': {
      // Stored before Juno knew its kind (a table synced by an older version): read it as that kind now.
      const known = decodeBlock(block.raw)
      return known._tag === 'Some' && known.value.type !== 'unknown' ? blocksFromMessageBlock(known.value, lookups) : unknownBlocks(block.raw, lookups)
    }
  }
}

const decodeBlock = Schema.decodeUnknownOption(SlackBlockSchema)

/** A table, its short rows filled with empty cells so every column lines up. No rows, no table. */
function tableBlocks(block: TableBlock, lookups: Lookups): Block[] {
  const width = Math.max(0, ...block.rows.map((row) => row.length))
  if (width === 0) return []
  const columns = (block.column_settings ?? []).slice(0, width).map(tableColumn)
  const caption = block.caption?.trim() ?? ''
  return [{
    kind: 'table',
    rows: block.rows.map((row) => Array.from({ length: width }, (_, column) => cellInlines(row[column] ?? null, lookups))),
    ...(columns.some((column) => column.align !== undefined || column.wrap !== undefined) ? { columns } : {}),
    ...(caption === '' ? {} : { caption, ...(block.is_caption_visible === true ? { showCaption: true as const } : {}) }),
  }]
}

function tableColumn(setting: TableColumnSetting | null): TableColumn {
  const align = setting?.align === 'center' || setting?.align === 'right' ? setting.align : undefined
  return { ...(align === undefined ? {} : { align }), ...(setting?.is_wrapped === true ? { wrap: true as const } : {}) }
}

/** A cell's content as one run of inlines: its paragraphs, list items and code one per line. */
function cellInlines(cell: TableCell, lookups: Lookups): Inline[] {
  if (cell === null) return []
  switch (cell.type) {
    case 'raw_text':
    case 'raw_number':
      return normalize(textRuns(cell.text))
    case 'unknown':
      return normalize(textRuns(unknownText(cell.raw)))
    case 'rich_text': {
      const lines = blocksFromMessageBlock(cell, lookups).flatMap((child) => {
        if (child.kind === 'list') return child.items
        if (child.kind === 'code') return [textRuns(child.text, { code: true })]
        return 'children' in child ? [child.children] : []
      })
      return lines.flatMap((line, index) => (index === 0 ? line : [{ kind: 'break' as const }, ...line]))
    }
  }
}

function paragraphOf(children: Inline[]): Block[] {
  return children.length === 0 ? [] : [{ kind: 'paragraph', children }]
}

/** Renders `blocks`. Returns an empty body when nothing in them is renderable. */
export function bodyFromBlocks(blocks: ReadonlyArray<SlackBlock>, lookups: Lookups = {}): { readonly blocks: ReadonlyArray<Block> } {
  return { blocks: blocks.flatMap((block) => blocksFromMessageBlock(block, lookups)) }
}

function unknownBlocks(raw: Readonly<Record<string, unknown>>, lookups: Lookups): Block[] {
  if (typeof raw.image_url === 'string') return [{ kind: 'image', url: raw.image_url, alt: typeof raw.alt_text === 'string' ? raw.alt_text : 'Attachment image' }]
  const label = typeof raw.text === 'string' ? raw.text : raw.text && typeof raw.text === 'object' && 'text' in raw.text && typeof raw.text.text === 'string' ? raw.text.text : unknownText(raw)
  const children = typeof raw.url === 'string' ? [{ kind: 'link' as const, url: raw.url, text: label || raw.url }] : mrkdwnInlines(label, lookups)
  const nested = Array.isArray(raw.elements) ? raw.elements.flatMap((el: unknown) => el !== null && typeof el === 'object' ? unknownBlocks(Object.fromEntries(Object.entries(el)), lookups) : []) : []
  return [...paragraphOf(children), ...nested]
}
