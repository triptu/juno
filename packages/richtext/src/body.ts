/** Entry points: a Slack message in, a `MessageBody` out, plus text views of a body. */
import type { Message } from '@juno/slack-schema'
import type { Lookups, MessageBody } from './model'
import { bodyFromBlocks } from './from-blocks'
import { mrkdwnBlocks } from './from-mrkdwn'
import { inlineText } from './inline'

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
  const blocks = [...bodyFromBlocks(content.blocks ?? [], lookups).blocks]
  if (blocks.length === 0 && content.text) blocks.push(...mrkdwnBlocks(content.text, lookups))
  for (const attachment of content.attachments ?? []) {
    const text = attachment.fallback || [attachment.pretext, attachment.title, attachment.text, ...(attachment.fields ?? []).map((field) => [field.title, field.value].filter(Boolean).join(': '))].filter(Boolean).join('\n')
    if (text) blocks.push(...mrkdwnBlocks(text, lookups))
  }
  for (const file of content.files ?? []) {
    const width = file.original_w ?? file.thumb_360_w
    const height = file.original_h ?? file.thumb_360_h
    const dimensions = width !== undefined && height !== undefined && width > 0 && height > 0 ? { width, height } : {}
    blocks.push({ kind: 'file', id: file.id, name: file.title || file.name || file.id, mimetype: file.mimetype ?? 'application/octet-stream', ...dimensions })
  }
  return { blocks }
}

/** Parses mrkdwn text on its own, for callers that only have `text`. */
export function bodyFromMrkdwn(text: string, lookups: Lookups = {}): MessageBody {
  return { blocks: mrkdwnBlocks(text, lookups) }
}

/**
 * The whole body as plain text, quotes included. Mentions read as "@Name",
 * channels as "#name", emoji as unicode or ":name:". For search and checks.
 */
export function plainText(body: MessageBody): string {
  const parts: string[] = []
  for (const block of body.blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
        parts.push(inlineText(block.children))
        break
      case 'quote':
        parts.push(
          inlineText(block.children)
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n'),
        )
        break
      case 'code':
        parts.push(block.text)
        break
      case 'file':
        parts.push(block.name)
        break
      case 'list':
        parts.push(block.items.map((item) => inlineText(item)).join('\n'))
        break
      case 'divider':
        break
    }
  }
  return parts.join('\n')
}

/**
 * One-line text for a sidebar row: quote blocks dropped, breaks collapsed
 * to spaces, whitespace squeezed. Empty when the message was only a quote.
 */
export function previewText(body: MessageBody): string {
  const parts: string[] = []
  for (const block of body.blocks) {
    switch (block.kind) {
      case 'paragraph':
      case 'heading':
        parts.push(inlineText(block.children, ' '))
        break
      case 'code':
        parts.push(block.text)
        break
      case 'file':
        parts.push(block.name)
        break
      case 'list':
        parts.push(block.items.map((item) => inlineText(item, ' ')).join(' '))
        break
      case 'quote':
      case 'divider':
        break
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * "Sender: text" for a row preview. With nothing left after stripping
 * quotes the line is just the sender, so a row never shows a dangling colon.
 */
export function previewLine(sender: string, body: MessageBody): string {
  const text = previewText(body)
  return text.length === 0 ? sender : `${sender}: ${text}`
}
