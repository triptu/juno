import type { Attachment } from '@juno/slack-schema'
import type { Block, ContentBlock, Inline, Lookups, SharedSource } from './model'
import { bodyFromBlocks } from './from-blocks'
import { inlineText } from './inline'
import { mrkdwnBlocks, mrkdwnInlines } from './from-mrkdwn'

export function attachmentBlock(attachment: Attachment, lookups: Lookups): Extract<Block, { kind: 'attachment' }> {
  const blocks: ContentBlock[] = []
  if (attachment.pretext) blocks.push(...mrkdwnBlocks(attachment.pretext, lookups))
  // A shared Slack message carries its words twice, as blocks and as `text`.
  // Blocks win when they give anything, as they do for a message's own body.
  const shared = (attachment.message_blocks ?? []).flatMap((part) => part.message?.blocks ?? [])
  const rich = bodyFromBlocks([...(attachment.blocks ?? []), ...shared], lookups).blocks
  blocks.push(...rich)
  if (attachment.text && rich.length === 0) blocks.push(...mrkdwnBlocks(attachment.text, lookups))
  if (attachment.fields?.length) blocks.push({ kind: 'fields', items: attachment.fields.map((f) => mrkdwnInlines([f.title && `*${f.title}*`, f.value].filter(Boolean).join('\n'), lookups)) })
  const url = attachment.image_url || attachment.thumb_url
  if (url) blocks.push({ kind: 'image', url, alt: attachment.title || 'Attachment image', ...(attachment.image_width && attachment.image_height ? { width: attachment.image_width, height: attachment.image_height } : {}) })
  for (const action of attachment.actions ?? []) {
    const text = action.text || action.name || action.url || ''
    blocks.push({ kind: 'paragraph', children: action.url ? [{ kind: 'link', url: action.url, text }] : mrkdwnInlines(text, lookups) })
  }
  if (!blocks.length && !attachment.title && attachment.fallback) blocks.push(...mrkdwnBlocks(attachment.fallback, lookups))
  const titleUrl = attachment.title_link || attachment.from_url || attachment.original_url
  const title: Inline[] = titleUrl && attachment.title ? [{ kind: 'link', url: titleUrl, text: inlineText(mrkdwnInlines(attachment.title, lookups)) }] : mrkdwnInlines(attachment.title ?? '', lookups)
  // A shared message names its place from Juno's own data. When Juno does not know the place, Slack's footer stays, as a link to the message.
  const from = sharedFrom(attachment)
  const place = from === undefined ? undefined : lookups.place?.(from.channel)
  const source: SharedSource | undefined = from === undefined || place === undefined ? undefined : { kind: place.kind, name: place.name, url: from.url, thread: from.thread }
  const label = mrkdwnInlines(attachment.footer || attachment.service_name || '', lookups)
  const footer: Inline[] = source !== undefined ? []
    : from !== undefined ? [{ kind: 'link', url: from.url, text: inlineText(label) || (attachment.channel_name ? `#${attachment.channel_name}` : 'Slack message') }]
    : label
  const timestamp = Number(attachment.ts)
  if (attachment.ts !== undefined && Number.isFinite(timestamp) && Math.abs(timestamp) < 8.64e12) {
    if (footer.length) footer.push({ kind: 'text', text: ' · ' })
    footer.push({ kind: 'date', timestamp, format: '{date_short} at {time}', fallback: '' })
  }
  return { kind: 'attachment',
    ...(attachment.author_name ? { author: { name: attachment.author_name, ...(attachment.author_icon ? { icon: attachment.author_icon } : {}) } } : {}),
    ...(attachment.footer_icon || attachment.service_icon ? { footerIcon: attachment.footer_icon || attachment.service_icon } : {}),
    tint: attachmentTint(attachment.color), title, blocks, ...(source === undefined ? {} : { source }), footer }
}

/**
 * A shared Slack message's permalink, read: the conversation it was posted
 * in, and whether it was a reply (a reply's link carries `thread_ts`).
 * Undefined for any other attachment.
 */
function sharedFrom(attachment: Attachment): { readonly url: string; readonly channel: string; readonly thread: boolean } | undefined {
  if (attachment.is_share !== true && attachment.is_msg_unfurl !== true) return undefined
  const url = attachment.from_url
  if (url === undefined) return undefined
  const [, id, message] = PERMALINK.exec(url) ?? []
  const channel = attachment.channel_id || id
  if (channel === undefined || channel === '') return undefined
  const threadTs = THREAD_TS.exec(url)?.[1]
  return { url, channel, thread: threadTs !== undefined && threadTs.replace('.', '') !== message }
}

/** `https://<team>.slack.com/archives/<channel>/p<digits>`: the channel and the message's ts digits. */
const PERMALINK = /^https?:\/\/[^/?#]+\/archives\/([A-Z0-9]+)\/p(\d+)/
const THREAD_TS = /[?&]thread_ts=(\d+\.?\d*)/

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
