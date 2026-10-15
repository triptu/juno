import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type Json = Record<string, unknown>
type Call = (method: 'client.counts' | 'conversations.history', args: Record<string, string | number | boolean>, purpose: string) => Promise<Json | undefined>
const objects = (value: unknown): Json[] => Array.isArray(value) ? value.filter((v): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)) : []
const keys = ['title', 'title_link', 'pretext', 'text', 'fields', 'color', 'footer', 'ts', 'actions', 'image_url', 'thumb_url', 'author_name', 'blocks']
const types = ['section', 'context', 'header', 'divider', 'image', 'actions', 'rich_text']

/** No response values leave this function; fixtures preserve structure with every string replaced. */
export async function probeIntegrations(call: Call, out: string): Promise<void> {
  const counts = await call('client.counts', {}, 'integration-candidates')
  const pages: { messages: Json[]; bots: Json[] }[] = []
  for (const channel of objects(counts?.['channels']).slice(0, 24)) {
    if (typeof channel['id'] !== 'string') continue
    const page = await call('conversations.history', { channel: channel['id'], limit: 30 }, 'integration-sample')
    const messages = objects(page?.['messages'])
    const bots = messages.filter((m) => m['bot_id'] || m['bot_profile'] || m['subtype'] === 'bot_message')
    if (messages.length) pages.push({ messages, bots })
  }
  const selected = pages.toSorted((a, b) => b.bots.length / b.messages.length - a.bots.length / a.messages.length).slice(0, 4)
  const messages = selected.flatMap((p) => p.bots)
  const attachments = messages.flatMap((m) => objects(m['attachments']))
  const blocks = [...messages.flatMap((m) => objects(m['blocks'])), ...attachments.flatMap((a) => objects(a['blocks']))]
  const report = {
    sampledChannels: pages.length,
    selectedChannels: selected.map((p) => ({ messages: p.messages.length, bots: p.bots.length })),
    messages: messages.length, attachments: attachments.length,
    attachmentKeys: Object.fromEntries(keys.map((k) => [k, attachments.filter((a) => k in a).length])),
    blockTypes: Object.fromEntries(types.map((t) => [t, blocks.filter((b) => b['type'] === t).length])),
  }
  console.log(JSON.stringify(report, null, 2))
  await writeFile(join(out, 'integration-counts.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(out, 'integration-shapes.json'), JSON.stringify(messages.slice(0, 8).map(shape), null, 2) + '\n')
}

function shape(value: unknown): unknown {
  if (typeof value === 'string') return 'redacted'
  if (typeof value === 'number') return 0
  if (Array.isArray(value)) return value.map(shape)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]))
  return value
}
