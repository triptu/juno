/** Entry points: a Slack message in, a `MessageBody` out, plus text views of a body. */
import type { Lookups, MessageBody } from './model'
import type { MessageContent } from './slack-types'
import { bodyFromBlocks } from './from-blocks'
import { mrkdwnBlocks } from './from-mrkdwn'
import { inlineText } from './inline'

/**
 * Renders a message. `blocks` win when they produce anything; otherwise the
 * mrkdwn `text` is parsed. A message with neither gives an empty body.
 */
export function messageBody(content: MessageContent, lookups: Lookups = {}): MessageBody {
  if (content.blocks && content.blocks.length > 0) {
    const body = bodyFromBlocks(content.blocks, lookups)
    if (body.blocks.length > 0) return body
  }
  if (content.text !== undefined && content.text.length > 0) {
    return { blocks: mrkdwnBlocks(content.text, lookups) }
  }
  return { blocks: [] }
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
