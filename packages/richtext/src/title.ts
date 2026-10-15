import type { MessageContent } from './body'
import { messageBody, plainText } from './body'
import { inlineText } from './inline'

/** A bot's structured title is more useful than its event summary. */
export function messageTitle(content: MessageContent): string {
  const body = messageBody(content)
  const summary = content.text?.trim() ?? ''
  if (summary && !/pull request|\b(issue|alert|incident|deployment)\b|\b(opened|closed|merged|created|updated|resolved)\b/i.test(summary)) return plainText(body)
  const title = body.blocks.find((block) => block.kind === 'attachment' && block.title.length || block.kind === 'heading')
  if (title?.kind === 'attachment') return /pull request|\/pull\//i.test(summary + JSON.stringify(content.attachments?.map((a) => a.title_link))) ? inlineText(title.title).replace(/^#(\d+)\s+/, 'PR #$1: ') : inlineText(title.title)
  if (title?.kind === 'heading') return inlineText(title.children)
  return plainText(body)
}
