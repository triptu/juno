import type { Attachment } from '@juno/slack-schema'
import type { Block, ContentBlock, Inline, Lookups } from './model'
import { bodyFromBlocks } from './from-blocks'
import { inlineText } from './inline'
import { mrkdwnBlocks, mrkdwnInlines } from './from-mrkdwn'

export function attachmentBlock(attachment: Attachment, lookups: Lookups): Extract<Block, { kind: 'attachment' }> {
  const blocks: ContentBlock[] = []
  if (attachment.pretext) blocks.push(...mrkdwnBlocks(attachment.pretext, lookups))
  blocks.push(...bodyFromBlocks(attachment.blocks ?? [], lookups).blocks)
  if (attachment.text) blocks.push(...mrkdwnBlocks(attachment.text, lookups))
  if (attachment.fields?.length) blocks.push({ kind: 'fields', items: attachment.fields.map((f) => mrkdwnInlines([f.title && `*${f.title}*`, f.value].filter(Boolean).join('\n'), lookups)) })
  const url = attachment.image_url || attachment.thumb_url
  if (url) blocks.push({ kind: 'image', url, alt: attachment.title || 'Attachment image', ...(attachment.image_width && attachment.image_height ? { width: attachment.image_width, height: attachment.image_height } : {}) })
  for (const action of attachment.actions ?? []) {
    const text = action.text || action.name || action.url || ''
    blocks.push({ kind: 'paragraph', children: action.url ? [{ kind: 'link', url: action.url, text }] : mrkdwnInlines(text, lookups) })
  }
  if (!blocks.length && !attachment.title && attachment.fallback) blocks.push(...mrkdwnBlocks(attachment.fallback, lookups))
  const title: Inline[] = attachment.title_link && attachment.title ? [{ kind: 'link', url: attachment.title_link, text: inlineText(mrkdwnInlines(attachment.title, lookups)) }] : mrkdwnInlines(attachment.title ?? '', lookups)
  const footer = mrkdwnInlines(attachment.footer ?? '', lookups)
  const timestamp = Number(attachment.ts)
  if (attachment.ts !== undefined && Number.isFinite(timestamp) && Math.abs(timestamp) < 8.64e12) {
    if (footer.length) footer.push({ kind: 'text', text: ' · ' })
    footer.push({ kind: 'date', timestamp, format: '{date_short} at {time}', fallback: '' })
  }
  return { kind: 'attachment', tint: attachmentTint(attachment.color), title, blocks, footer }
}

function attachmentTint(color: string | undefined): Extract<Block, { kind: 'attachment' }>['tint'] {
  if (color === 'good') return 'success'
  if (color === 'warning') return 'warning'
  if (color === 'danger') return 'danger'
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color ?? '')
  if (!match) return 'neutral'
  const r = parseInt(match[1] ?? '', 16), g = parseInt(match[2] ?? '', 16), b = parseInt(match[3] ?? '', 16)
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return 'neutral'
  if (r > g * 1.4 && r > b * 1.4) return 'danger'
  if (r > b * 1.4 && g > b * 1.4) return 'warning'
  return g > r && g > b ? 'success' : 'info'
}
