import type { MessageContent } from './body'
import { messageBody, plainText } from './body'
import { inlineText } from './inline'

/** A bot's structured title is more useful than its event summary. */
export function messageTitle(content: MessageContent): string {
  const body = messageBody(content)
  const summary = content.text?.trim() ?? ''
  const eventSummary = /\b(pull request|issue|incident|deployment)\b.{0,80}\b(opened|closed|merged|created|updated|resolved)\b|\b(opened|closed|merged|created|updated|resolved)\b.{0,80}\b(pull request|issue|incident|deployment)\b|^alert:/i.test(summary)
  if (summary && !eventSummary && !content.attachments?.some((attachment) => attachment.fallback === summary)) return plainText(body)
  const pullRequest = /pull request/i.test(summary) || content.attachments?.some((attachment) => /\/pull\/\d+/.test(attachment.title_link ?? ''))
  for (const block of body.blocks) {
    if (block.kind === 'heading') return inlineText(block.children)
    if (block.kind !== 'attachment') continue
    if (block.title.length) {
      const title = inlineText(block.title)
      return pullRequest ? title.replace(/^#(\d+)\s+/, 'PR #$1: ') : title
    }
    const heading = block.blocks.find((child) => child.kind === 'heading')
    if (heading?.kind === 'heading') return inlineText(heading.children)
  }
  return plainText(body)
}
