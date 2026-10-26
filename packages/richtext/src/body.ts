/** Entry points: a Slack message in, a `MessageBody` out, plus text views of a body. */
import type { Message } from '@juno/slack-schema'
import type { Block, Lookups, MessageBody } from './model'
import { bodyFromBlocks } from './from-blocks'
import { mrkdwnBlocks } from './from-mrkdwn'
import { attachmentBlock, fileBlock } from './attachments'
import { inlineText } from './inline'
import { tableText } from './table-text'

/**
 * The part of a Slack message that carries its content. A decoded
 * `@juno/slack-schema` `Message` is one; so is anything with the same two fields.
 */
export type MessageContent = Pick<Message, 'text' | 'blocks' | 'files' | 'attachments'>

/**
 * Renders a message. `blocks` win when they produce anything; otherwise the
 * mrkdwn `text` is parsed. A message with neither gives an empty body.
 */
export function messageBody(content: MessageContent, lookups: Lookups = {}): MessageBody {
  const blocks: Block[] = [...bodyFromBlocks(content.blocks ?? [], lookups).blocks]
  if (blocks.length === 0 && content.text) blocks.push(...mrkdwnBlocks(content.text, lookups))
  for (const attachment of content.attachments ?? []) {
    blocks.push(attachmentBlock(attachment, lookups))
  }
  for (const file of content.files ?? []) blocks.push(fileBlock(file))
  return { blocks }
}

/** Parses mrkdwn text on its own, for callers that only have `text`. */
export function bodyFromMrkdwn(text: string, lookups: Lookups = {}): MessageBody {
  return { blocks: mrkdwnBlocks(text, lookups) }
}

/**
 * The whole body as plain text, quotes included. Mentions read as "@Name",
 * channels as "#name", emoji as unicode or ":name:". A table is one line per
 * row with its cells split by tabs, as a spreadsheet takes a paste. For
 * copy, search, Ask Juno and checks.
 */
export function plainText(body: MessageBody): string {
  return bodyText(body, { quotes: true, shown: false, tables: true })
}

/**
 * The text as a person reads it, for notification bodies and search
 * snippets: as `plainText`, but a code block's tag line (```ts) is left
 * out, as the view leaves it out. `plainText` keeps it, for the edit field
 * and what goes back to Slack.
 */
export function readableText(body: MessageBody): string {
  return bodyText(body, { quotes: true, shown: true, tables: true })
}

/** A code block's text as the view shows it: without its tag line. */
const shownCode = (block: { readonly text: string; readonly tagLine?: true }) => (block.tagLine ? block.text.slice(block.text.indexOf('\n') + 1) : block.text)

interface TextOptions {
  /** Quote blocks are included, as "> " lines. */
  readonly quotes: boolean
  /** Code as the view shows it, without its tag line. */
  readonly shown: boolean
  /** Tables are included as tab-separated rows. */
  readonly tables: boolean
}

function bodyText(body: MessageBody, options: TextOptions): string {
  const { quotes, shown, tables } = options
  const parts: string[] = []
  for (const block of body.blocks) {
    switch (block.kind) {
      case 'attachment':
        parts.push(inlineText(block.title), bodyText({ blocks: block.blocks }, options), inlineText(block.footer))
        break
      case 'table':
        if (tables) parts.push(tableText(block.rows))
        break
      case 'fields':
        parts.push(...block.items.map((item) => inlineText(item)))
        break
      case 'image':
        parts.push(block.alt)
        break
      case 'context':
      case 'paragraph':
      case 'heading':
        parts.push(inlineText(block.children))
        break
      case 'quote':
        if (!quotes) break
        parts.push(
          inlineText(block.children)
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n'),
        )
        break
      case 'code':
        parts.push(shown ? shownCode(block) : block.text)
        break
      case 'file':
        parts.push(block.name)
        break
      case 'list':
        parts.push(block.items.map((item) => inlineText(item)).join('\n'))
        break
      case 'divider':
      case 'buttons':
        break
    }
  }
  return parts.filter(Boolean).join('\n')
}

/**
 * One-line text for a sidebar row: quote blocks dropped, breaks collapsed
 * to spaces, whitespace squeezed, a code block's tag line left out. Tables
 * are left out too; a message whose only words are in a table reads
 * "Table: " and its first row with words, cells split by commas
 * ("Table: Service, Status, Owner"), or "Table" when no cell has any. Empty
 * when the message was only a quote.
 */
export function previewText(body: MessageBody): string {
  const text = oneLine(bodyText(body, { quotes: false, shown: true, tables: false }))
  if (text !== '') return text
  const table = firstTable(body.blocks)
  if (table === undefined) return ''
  for (const row of table.rows) {
    const cells = row.map((cell) => oneLine(inlineText(cell))).filter((cell) => cell !== '')
    if (cells.length > 0) return `Table: ${cells.join(', ')}`
  }
  return 'Table'
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

type TableBlock = Extract<Block, { kind: 'table' }>

/** The first table, in a shared message's card too. */
function firstTable(blocks: ReadonlyArray<Block>): TableBlock | undefined {
  for (const block of blocks) {
    if (block.kind === 'table') return block
    if (block.kind === 'attachment') {
      const inner = firstTable(block.blocks)
      if (inner !== undefined) return inner
    }
  }
  return undefined
}

/**
 * "Sender: text" for a row preview. With nothing left after stripping
 * quotes the line is just the sender, so a row never shows a dangling colon.
 */
export function previewLine(sender: string, body: MessageBody): string {
  const text = previewText(body)
  return text.length === 0 ? sender : `${sender}: ${text}`
}
