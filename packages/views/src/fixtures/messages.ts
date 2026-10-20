/**
 * Sample topics for the gallery: headers, message windows and active
 * threads shaped like the contract's `TopicDetail`, `MessageView` and
 * `ThreadSummary`, modelled on the fake Slack seed. Everything is invented.
 * Times are relative to `NOW` so the fixtures hold still.
 */
import { pendingRowId, type BodyBlock, type BodyInline, type FileView, type MessageView, type PendingState, type Person, type ReactionView, type ThreadLink, type ThreadSummary, type TopicDetail } from '@juno/contract'
import type { MessageListItem } from '../MessageList'
import { channels, NOW, people } from './topics'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const me: Person = { id: 'U0ME', name: 'Tushar', color: 'cyan' }

// Inlines and blocks

export const t = (text: string, style?: { bold?: true; italic?: true; strike?: true; code?: true }): BodyInline => (style ? { kind: 'text', text, style } : { kind: 'text', text })
export const link = (url: string, text = url): BodyInline => ({ kind: 'link', url, text })
export const mention = (person: Person, isMe = false): BodyInline => ({ kind: 'user', id: person.id, name: person.name, isMe })
export const you: BodyInline = { kind: 'user', id: me.id, name: me.name, isMe: true }
export const channel = (ref: { id: string; name: string }): BodyInline => ({ kind: 'channel', id: ref.id, name: ref.name })
export const emoji = (name: string, unicode?: string, url?: string): BodyInline => ({ kind: 'emoji', name, ...(unicode === undefined ? {} : { unicode }), ...(url === undefined ? {} : { url }) })
export const date = (timestamp: number, format: string, fallback: string): BodyInline => ({ kind: 'date', timestamp, format, fallback })

export const p = (...children: ReadonlyArray<BodyInline | string>): BodyBlock => ({ kind: 'paragraph', children: children.map((child) => (typeof child === 'string' ? t(child) : child)) })
export const quote = (...children: ReadonlyArray<BodyInline | string>): BodyBlock => ({ kind: 'quote', children: children.map((child) => (typeof child === 'string' ? t(child) : child)) })
/** A code block; `language` is set when its first line was a tag (richtext has already taken that line out). */
export const code = (text: string, language?: string): BodyBlock => (language === undefined ? { kind: 'code', text } : { kind: 'code', text, language })
export const list = (style: 'bullet' | 'ordered' | 'checked' | 'unchecked', items: ReadonlyArray<string>, indent = 0): BodyBlock => ({
  kind: 'list',
  style,
  indent,
  items: items.map((item) => [t(item)]),
})
export const heading = (text: string): BodyBlock => ({ kind: 'heading', children: [t(text)] })
export const divider: BodyBlock = { kind: 'divider' }

const partyBlob = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#E39A3B"/><circle cx="11" cy="13" r="2" fill="#2B1E00"/><circle cx="21" cy="13" r="2" fill="#2B1E00"/><path d="M10 20c3 4 9 4 12 0" stroke="#2B1E00" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
)}`

// Reactions and files

export const reaction = (name: string, unicode: string, count: number, mine = false): ReactionView => ({ name, count, me: mine, unicode })
export const customReaction = (name: string, count: number, mine = false): ReactionView => ({ name, count, me: mine, url: partyBlob })
/** A custom emoji the workspace does not know: the chip shows `:name:`. */
export const unknownReaction = (name: string, count: number): ReactionView => ({ name, count, me: false })
/** A workspace emoji on a text line. */
export const customEmoji = (name: string): BodyInline => emoji(name, undefined, partyBlob)

/** An SVG of the given size, so a thumbnail has real bytes and a real aspect ratio. */
export const picture = (width: number, height: number, fill: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/><circle cx="${width * 0.3}" cy="${height * 0.4}" r="${Math.min(width, height) * 0.12}" fill="#F4E6D3"/><path d="M0 ${height} L${width * 0.35} ${height * 0.55} L${width * 0.6} ${height * 0.8} L${width * 0.8} ${height * 0.62} L${width} ${height}Z" fill="#2B2A26" fill-opacity="0.25"/></svg>`,
  )}`

/** A picture that never arrives: the gallery server holds this request open. */
export const PENDING_PICTURE = '/__fixture/pending.png'

export const image = (id: string, name: string, width: number, height: number, src: string, size = 418_221): FileView => ({
  id,
  name,
  kind: 'image',
  mimetype: 'image/png',
  size,
  width,
  height,
  thumb: { src, width: Math.min(width, 1024), height: Math.round((Math.min(width, 1024) / width) * height) },
})

export const files = {
  landscape: image('F0LAND', 'replica-lag-dashboard.png', 1600, 900, picture(1600, 900, '#8EB5C9')),
  portrait: image('F0PORT', 'IMG_2043.jpg', 900, 1400, picture(900, 1400, '#C9A98E')),
  square: image('F0SQ', 'avatar-candidates.png', 1000, 1000, picture(1000, 1000, '#A7B8A0')),
  small: image('F0SMALL', 'icon.png', 120, 80, picture(120, 80, '#D9C7E8'), 2_140),
  wide: image('F0WIDE', 'timeline.png', 2400, 500, picture(2400, 500, '#E8D9C7')),
  pending: image('F0PEND', 'staging-screenshot.png', 1200, 800, PENDING_PICTURE),
  failed: image('F0FAIL', 'expired-thumbnail.png', 1200, 800, 'data:image/png;base64,AAAA'),
  noDims: { id: 'F0NODIM', name: 'whiteboard.heic', kind: 'image', mimetype: 'image/heic', size: 3_201_544 } satisfies FileView,
  pdf: { id: 'F0PDF', name: 'Postgres 16 cutover runbook.pdf', kind: 'pdf', mimetype: 'application/pdf', size: 1_284_311 } satisfies FileView,
  sheet: { id: 'F0XLS', name: 'replica-sizing-options-and-costs-q4.xlsx', kind: 'file', mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 88_120 } satisfies FileView,
  video: { id: 'F0MOV', name: 'demo.mov', kind: 'video', mimetype: 'video/quicktime', size: 48_120_000 } satisfies FileView,
  deleted: { id: 'F0DEL', name: 'old-plan.png', kind: 'deleted' } satisfies FileView,
} as const

// Messages

interface MessageInput {
  /** Minutes before NOW. */
  readonly ago: number
  readonly from: Person | undefined
  readonly blocks?: ReadonlyArray<BodyBlock>
  readonly text?: string
  readonly kind?: MessageView['kind']
  readonly reactions?: ReadonlyArray<ReactionView>
  readonly files?: ReadonlyArray<FileView>
  readonly thread?: ThreadLink
  readonly edited?: boolean
  readonly mentionsMe?: boolean
  readonly broadcast?: boolean
  readonly root?: boolean
  readonly groupStart?: boolean
  /** Keeps `ts` unique for two messages in the same minute. */
  readonly seq?: number
  /** A message Juno is still sending, or failed to send. */
  readonly pending?: PendingState
}

let counter = 0

/** One row and its sender. `groupStart` follows the domain rule (a new sender, a quote, a root) unless given. */
export function message(input: MessageInput, previous?: MessageListItem): MessageListItem {
  counter += 1
  const at = NOW - input.ago * MINUTE
  const seq = input.seq ?? counter
  const ts = input.pending === undefined ? `${Math.floor(at / 1000)}.${String(seq).padStart(6, '0')}` : pendingRowId(`fixture-${seq}`)
  const blocks = input.blocks ?? (input.text === undefined ? [] : [p(input.text)])
  const hasQuote = blocks.some((block) => block.kind === 'quote')
  const groupStart = input.groupStart ?? (previous === undefined || previous.message.senderId !== input.from?.id || input.root === true || hasQuote)
  const view: MessageView = {
    id: ts,
    rev: 1,
    ts,
    at,
    kind: input.kind ?? 'message',
    ...(input.from === undefined ? {} : { senderId: input.from.id }),
    fromMe: input.from?.id === me.id,
    body: { blocks },
    edited: input.edited ?? false,
    groupStart,
    mentionsMe: input.mentionsMe ?? blocks.some((block) => 'children' in block && block.children.some((inline) => inline.kind === 'user' && inline.isMe)),
    broadcast: input.broadcast ?? false,
    root: input.root ?? false,
    reactions: input.reactions ?? [],
    files: input.files ?? [],
    ...(input.thread === undefined ? {} : { thread: input.thread }),
    ...(input.pending === undefined ? {} : { clientMsgId: `fixture-${seq}`, pending: input.pending }),
  }
  return { message: view, sender: input.from }
}

/** A window of rows, grouped in order. */
export function window(inputs: ReadonlyArray<MessageInput>): ReadonlyArray<MessageListItem> {
  const items: MessageListItem[] = []
  for (const input of inputs) items.push(message(input, items[items.length - 1]))
  return items
}

/** The end of a thread where the owner's last message is still sending, and one where it failed. */
const sendInputs = (state: PendingState): ReadonlyArray<MessageInput> => [
  { ago: 12, from: people.maya, text: 'Can someone own the rollback test before Thursday?' },
  { ago: 3, from: me, text: 'I can take it.' },
  { ago: 0, from: me, text: 'I will run it against the replica tonight and post the numbers here.', pending: state },
]
export const sending = window(sendInputs('sending'))
export const failedSend = window(sendInputs('failed'))

/** A person the store does not know: the row shows the raw id. */
export const unknownUser: Person = { id: 'U0ZZ9XK2Q', name: 'U0ZZ9XK2Q', color: 'rose' }

const LONG_WORD = 'x'.repeat(5000)

/** The Postgres 16 migration thread: a long thread with grouping, a quote, code, a list, reactions and a mention of you. */
export const thread = window([
  { ago: 3 * HOUR / MINUTE + 50, from: people.leo, root: true, text: 'Draft plan is in the doc. Short version: logical replication to the new cluster, cut over behind the read-only flag, about a 4 minute write freeze.' },
  { ago: 3 * HOUR / MINUTE + 42, from: people.dev, text: '4 minutes is fine for us. Billing webhooks retry for 30 min, so nothing gets dropped.' },
  { ago: 3 * HOUR / MINUTE + 31, from: people.sam, text: "Good. What's the rollback if replication lags on cutover day?" },
  { ago: 3 * HOUR / MINUTE + 18, from: people.leo, text: 'We keep the old primary warm for 48h. Flip DNS back and replay from the WAL position we logged.', reactions: [reaction('+1', '👍', 2, true)] },
  { ago: 3 * HOUR / MINUTE + 17, from: people.leo, blocks: [p('The exact position goes in the runbook, step 4:'), code('SELECT pg_current_wal_lsn();\n-- 0/3A6B2D8\nSELECT pg_last_wal_replay_lsn();')] },
  { ago: 2 * HOUR / MINUTE + 55, from: people.maya, blocks: [p('Checklist for Thursday:'), list('checked', ['Backups verified on the new cluster', 'Read-only flag tested in staging']), list('unchecked', ['Page the on-call 10 minutes before the freeze', 'Post in #eng when writes are back'])] },
  { ago: 2 * HOUR / MINUTE + 40, from: people.dev, blocks: [quote("What's the rollback if replication lags on cutover day?"), p('I can own the dry run on staging Thursday.')] },
  { ago: 2 * HOUR / MINUTE + 12, from: people.priya, blocks: [p('Links for the record: ', link('https://example.com/runbook/postgres-16', 'runbook'), ' and the ', link('https://example.com/dash/replica-lag', 'replica lag dashboard'), '.')] },
  { ago: 2 * HOUR / MINUTE + 11, from: people.priya, blocks: [p('Dashboard snapshot from this morning:')], files: [files.landscape] },
  { ago: 95, from: people.sam, blocks: [p('Dry run is ', date(Math.floor((NOW + 2 * DAY) / 1000), '{date_short_pretty} at {time}', 'Thursday at 14:00'), '. Calendar invite sent.')], edited: true },
  { ago: 80, from: people.elena, blocks: [p('One more thing ', emoji('eyes', '👀'), ' the vendor contract covers the new cluster from ', t('next month', { bold: true }), ', not this one. Finance is aware.')], reactions: [reaction('eyes', '👀', 1), customReaction('party-blob', 3, true)] },
  { ago: 41, from: people.leo, blocks: [p('Thursday works. ', mention(people.dev), " I'll pair. ", you, ' can you grab the replica sizing from ', channel(channels.eng), '?')] },
  { ago: 40, from: people.leo, blocks: [p(emoji('tada', '🎉'), emoji('rocket', '🚀'))] },
  { ago: 4, from: me, text: 'Booked 2–4pm. Will post results here.' },
])

/** The first unread message in `thread`: the divider goes before Elena's. */
export const threadDividerBefore = thread[10]?.message.ts ?? ''

/** #eng Main: a stream with thread links, a broadcast reply and a message from a bot. */
export const main = window([
  { ago: 4 * HOUR / MINUTE, from: people.sam, text: 'Reminder: on-call handoff moves to Mondays starting next week.' },
  { ago: 4 * HOUR / MINUTE - 3, from: people.dev, text: 'noted', reactions: [reaction('+1', '👍', 4, true), reaction('white_check_mark', '✅', 1)] },
  { ago: 4 * HOUR / MINUTE - 18, from: people.jonas, text: 'Does that include the weekend secondary?' },
  { ago: 4 * HOUR / MINUTE - 20, from: people.sam, text: 'Yes, both rotations move together.' },
  {
    ago: 2 * HOUR / MINUTE + 2,
    from: people.leo,
    text: 'Unrelated: has anyone looked at the staging bill? It doubled since August.',
    thread: { id: 'C0ENG:1759993200.000100', replyCount: 2, label: '2 replies', title: 'Staging bill doubled since August', titleSource: 'ai', lastReplyAt: NOW - 50 * MINUTE },
  },
  { ago: 119, from: people.dev, blocks: [p(mention(people.leo), ' I think the preview environments never shut down. Will check.')] },
  { ago: 70, from: people.grafana, blocks: [p(t('[RESOLVED]', { bold: true }), ' queue depth > 5k on billing-consumer')] },
  {
    ago: 58,
    from: people.maya,
    text: 'Postgres 16 migration plan is up for review. Thursday is the dry run.',
    thread: { id: 'C0ENG:1760000000.000100', replyCount: 14, label: '14 replies', title: 'Postgres 16 migration plan', titleSource: 'ai', lastReplyAt: NOW - 4 * MINUTE },
  },
  { ago: 30, from: people.dev, text: 'Replica lag back under a second.', broadcast: true },
  {
    ago: 12,
    from: people.priya,
    text: 'Anyone else seeing slow CI on the main branch?',
    thread: { id: 'C0ENG:1759999280.000100', replyCount: 1, label: '1 reply', title: 'Anyone else seeing slow CI on the main branch?', titleSource: 'fallback' },
  },
  {
    ago: 6,
    from: people.elena,
    text: 'Office is closed Friday for the floor refit.',
    thread: { id: 'C0ENG:1759999640.000100', replyCount: 0, label: 'Thread', title: 'Office is closed Friday for the floor refit.', titleSource: 'fallback' },
  },
])

export const mainDividerBefore = main[8]?.message.ts ?? ''

/** The hiring thread: a private channel, two messages that mention you. */
export const mentions = window([
  { ago: 4 * HOUR / MINUTE, from: people.elena, root: true, text: 'Rina finished the onsite. Panel notes are in the scorecard.' },
  { ago: 3 * HOUR / MINUTE, from: people.sam, text: 'Strong systems design. Went deep on idempotency without being prompted.' },
  { ago: 12, from: people.elena, blocks: [p(you, ' she has a competing offer with a Friday deadline. Can you do a 30 min close call tomorrow?')] },
  { ago: 11, from: people.elena, blocks: [p('cc ', { kind: 'broadcast', range: 'here' }, ' in case someone else has a slot.')] },
])

/** Right-to-left: an Arabic thread with a Latin name in the middle. */
export const rtl = window([
  { ago: 50, from: people.mohammed, root: true, text: 'هل يمكننا مراجعة خطة الترحيل غدًا قبل الاجتماع الأسبوعي؟' },
  { ago: 44, from: people.dev, text: 'Sure, 10am works for me.' },
  { ago: 30, from: people.mohammed, blocks: [p('شكرًا جزيلًا، سأرسل الملاحظات بعد الظهر. ', mention(people.dev))] },
  { ago: 29, from: people.mohammed, blocks: [quote('Sure, 10am works for me.'), p('تم الحجز.')] },
])

/** Emoji only, one to three of them, drawn larger. */
export const emojiOnly = window([
  { ago: 20, from: people.unicorn, text: 'Shipped the fix.' },
  { ago: 19, from: people.party, blocks: [p(emoji('tada', '🎉'))] },
  { ago: 18, from: people.unicorn, blocks: [p(emoji('tada', '🎉'), ' ', emoji('rocket', '🚀'), ' ', emoji('fire', '🔥'))] },
  { ago: 17, from: people.party, blocks: [p(emoji('party-blob', undefined, partyBlob))] },
  { ago: 16, from: people.party, blocks: [p(emoji('tada', '🎉'), ' nice one')] },
])

/** Hostile content: a 5,000-character word, a very long code block, a missing user and a deleted message. */
export const hostile = window([
  { ago: 60, from: unknownUser, text: 'Message from a user the store has not seen yet.' },
  { ago: 55, from: people.jonas, text: `Token for the test tenant: ${LONG_WORD}` },
  { ago: 50, from: people.jonas, blocks: [code(Array.from({ length: 60 }, (_, index) => `line ${index + 1}: ${'='.repeat(40)}`).join('\n'))] },
  { ago: 40, from: people.dev, kind: 'deleted', text: '' },
  { ago: 35, from: undefined, kind: 'unloaded', text: '' },
  { ago: 30, from: people.sam, blocks: [heading('Decision'), p('We go with option B.'), divider, p(t('Struck', { strike: true }), ' ', t('italic', { italic: true }), ' ', t('inline code', { code: true }), ' ', t('bold', { bold: true }))] },
  { ago: 25, from: people.leo, blocks: [list('bullet', ['Top level']), list('bullet', ['Nested once'], 1), list('bullet', ['Nested twice'], 2), list('ordered', ['First', 'Second'])] },
])

/** A sender whose name is longer than a message header, and messages whose first line fills the row. */
export const longName: Person = { id: 'U0LONGNAME', name: 'Maximilian-Alexander Fitzgerald-Montgomery-Rutherford of the platform team', color: 'jordy' }

export const longFirstLine = window([
  {
    ago: 30,
    from: longName,
    text: 'WAL position on the replica is 40 minutes behind primary and still falling back, so the read-only cutover window we promised for tonight is not safe unless someone finds the slow query first.',
  },
  { ago: 29, from: longName, text: 'Second line of the same run, a continuation row with a long first line that also reaches the end of the column before it wraps onto the next.' },
  { ago: 20, from: people.maya, text: 'Looking now.' },
])

/** A sixty-line code block, then enough replies that the list is taller than its frame. */
export const longCode = window([
  { ago: 60, from: people.maya, text: 'Here is the whole migration log, for the record.' },
  { ago: 59, from: people.jonas, blocks: [p('Pasting it in full:'), code(Array.from({ length: 60 }, (_, index) => `line ${index + 1}: ${'='.repeat(40)}`).join('\n'))] },
  { ago: 50, from: people.leo, text: 'Thanks. The failure is on line 41.' },
  { ago: 49, from: people.maya, text: 'Agreed, fixing.' },
  ...Array.from({ length: 12 }, (_, index) => ({ ago: 48 - index, from: index % 2 === 0 ? people.leo : people.maya, text: `Follow-up ${index + 1} on the migration log.` })),
])

/** Fifty reaction kinds on one message, and a few on another. */
export const manyReactions = window([
  { ago: 30, from: people.maya, text: 'Reply ideas shipped. Thank you all.', reactions: Array.from({ length: 50 }, (_, index) => reaction(`emoji-${index}`, String.fromCodePoint(0x1f600 + index), 1 + (index % 7), index % 9 === 0)) },
  { ago: 20, from: people.leo, text: 'and the pressed one', reactions: [reaction('heart', '❤️', 12, true), reaction('rocket', '🚀', 3), customReaction('party-blob', 1)] },
])

/** Thumbnails of several aspect ratios, a pending one, a failed one, and cards. */
export const withFiles = window([
  { ago: 90, from: people.priya, text: 'Dashboards from this morning, one per cluster.', files: [files.landscape, files.wide] },
  { ago: 85, from: people.priya, blocks: [p('And the phone shot from the DC:')], files: [files.portrait] },
  { ago: 80, from: people.dev, text: 'Avatar candidates:', files: [files.square, files.small] },
  { ago: 60, from: people.sam, text: 'Runbook and the sizing sheet.', files: [files.pdf, files.sheet] },
  { ago: 50, from: people.leo, text: 'Whiteboard photo (no dimensions from Slack) and a video.', files: [files.noDims, files.video] },
  { ago: 40, from: people.maya, text: 'Old plan, since removed.', files: [files.deleted] },
])

/** One image that never arrives: the box is its final size from the start. */
export const pendingFile = window([{ ago: 10, from: people.priya, text: 'Staging after the fix:', files: [files.pending] }])

/** A made-up download url: main fetches the real one on the Slack session. */
export const downloadUrl = (id: string) => `https://files.example.invalid/${id}/download`

/** Files Slack holds: the cards get Download, the images open in the viewer at full size. */
export const downloadable = {
  pdf: { ...files.pdf, download: downloadUrl(files.pdf.id) },
  sheet: { ...files.sheet, download: downloadUrl(files.sheet.id) },
  landscape: { ...files.landscape, full: picture(1600, 900, '#8EB5C9'), download: downloadUrl(files.landscape.id) },
  portrait: { ...files.portrait, full: picture(900, 1400, '#C9A98E'), download: downloadUrl(files.portrait.id) },
} satisfies Record<string, FileView>

export const withDownloads = window([
  { ago: 60, from: people.sam, text: 'Runbook and the sizing sheet.', files: [downloadable.pdf, downloadable.sheet] },
  { ago: 55, from: people.priya, text: 'Dashboard from this morning.', files: [downloadable.landscape] },
])

/** The owner's message going out with a picture and a runbook, still uploading or refused. */
const uploadInputs = (state: PendingState): ReadonlyArray<MessageInput> => [
  { ago: 12, from: people.maya, text: 'Can you share the numbers from last night?' },
  { ago: 0, from: me, text: 'Here they are, with the runbook.', files: [files.landscape, files.pdf], pending: state },
]
export const uploading = window(uploadInputs('sending'))
export const uploadFailed = window(uploadInputs('failed'))

/** One image whose bytes fail: the box keeps its size and shows a glyph. */
export const failedFile = window([{ ago: 10, from: people.priya, text: 'Expired thumbnail:', files: [files.failed] }])

// Headers

const detail = (input: Partial<TopicDetail> & Pick<TopicDetail, 'id' | 'title' | 'channel'>): TopicDetail => ({
  kind: 'thread',
  titleSource: 'fallback',
  status: 'open',
  subscribed: true,
  pinned: false,
  resolved: false,
  messageCount: 14,
  unreadCount: 0,
  unreadExact: true,
  mentionsMe: false,
  lastActivityTs: thread[thread.length - 1]?.message.ts ?? '',
  ...input,
})

export const details = {
  postgres: detail({ id: 'C0ENG:1760000000.000100', title: 'Postgres 16 migration plan', titleSource: 'ai', channel: channels.eng, unreadCount: 4, mentionsMe: true, lastReadTs: thread[9]?.message.ts ?? '', rootTs: thread[0]?.message.ts ?? '' }),
  hiring: detail({ id: 'C0HIRING:1760000000.000300', title: 'Rina Sato · Staff backend', titleSource: 'ai', channel: channels.hiring, messageCount: 4, unreadCount: 2, mentionsMe: true }),
  offsite: detail({ id: 'D0MAYA:1759990000.000500', title: 'Offsite: Wednesday afternoon slot', titleSource: 'manual', channel: channels.maya, pinned: true, messageCount: 3 }),
  lunch: detail({ id: 'G0MAYALEO:main', kind: 'main', title: 'Maya, Leo', titleSource: 'channel', channel: channels.group, messageCount: 3, threadCount: 0 }),
  engMain: detail({ id: 'C0ENG:main', kind: 'main', title: '#eng', titleSource: 'channel', channel: channels.eng, messageCount: 412, unreadCount: 3, lastReadTs: main[7]?.message.ts ?? '', threadCount: 12 }),
  mohammed: detail({ id: 'D0MOHAMMED:1759990000.001100', title: 'هل يمكننا مراجعة خطة الترحيل غدًا قبل الاجتماع الأسبوعي', channel: channels.mohammed, messageCount: 4 }),
  long: detail({
    id: 'C0DESIGNREV:1759900000.000900',
    title: 'Two options for the thread list: compact rows versus two-line previews, and what we lose with each one',
    titleSource: 'manual',
    channel: { ...channels.design, name: 'design-review-and-critique-sessions' },
  }),
  flags: detail({ id: 'C0PLATFORM:1759900000.000800', title: "We have 142 flags. 61 haven't…", channel: { id: 'C0PLATFORM', kind: 'public', name: 'platform', label: '#platform', tint: 'public', icon: 'globe', color: 'jordy' }, status: 'unsubscribed', subscribed: false }),
  unicorn: detail({ id: 'D0UNICORN:1759990000.001300', title: '🎉🎉🎉', channel: channels.unicorn, messageCount: 5 }),
} as const satisfies Record<string, TopicDetail>

// Active threads of #eng

const summary = (input: Partial<ThreadSummary> & Pick<ThreadSummary, 'id' | 'title' | 'replyCount'> & { readonly ago: number }): ThreadSummary => {
  const { ago, ...rest } = input
  const at = NOW - ago * MINUTE
  return {
    rev: 1,
    rootTs: `${Math.floor((at - 2 * HOUR) / 1000)}.000100`,
    titleSource: 'ai',
    lastActivityTs: `${Math.floor(at / 1000)}.000100`,
    lastActivityAt: at,
    unreadCount: 0,
    unreadExact: true,
    mentionsMe: false,
    participantIds: [people.leo.id, people.dev.id],
    ...rest,
  }
}

export const engThreads: ReadonlyArray<ThreadSummary> = [
  summary({ id: 'C0ENG:1760000000.000100', title: 'Postgres 16 migration plan', replyCount: 14, ago: 4, unreadCount: 4, mentionsMe: true }),
  summary({ id: 'C0ENG:1759999280.000100', title: 'Anyone else seeing slow CI on the main branch?', replyCount: 1, ago: 9, titleSource: 'fallback' }),
  summary({ id: 'C0ENG:1759993200.000100', title: 'Staging bill doubled since August', replyCount: 2, ago: 50, unreadCount: 2 }),
  summary({ id: 'C0ENG:1759900000.001000', title: 'Replica sizing', replyCount: 6, ago: 7 * 60, titleSource: 'manual' }),
  summary({ id: 'C0ENG:1759800000.001000', title: 'Rotate the staging secrets before the audit, and document where each one lives', replyCount: 23, ago: 26 * 60, unreadCount: 60, unreadExact: false }),
  summary({ id: 'C0ENG:1759700000.001000', title: 'Flaky e2e on reconnect', replyCount: 3, ago: 3 * 24 * 60 }),
  summary({ id: 'C0ENG:1759600000.001000', title: 'Welcome Priya', replyCount: 31, ago: 5 * 24 * 60 }),
]

/** Every thread the store knows in #eng, for the header's topic switcher: the open ones, then the resolved ones. */
export const engTopics: ReadonlyArray<ThreadSummary> = [
  ...engThreads,
  { ...summary({ id: 'C0ENG:1759500000.001000', title: 'Pin the Node version in CI', replyCount: 5, ago: 8 * 24 * 60 }), resolved: true },
  { ...summary({ id: 'C0ENG:1759400000.001000', title: 'Postgres 15 point release', replyCount: 2, ago: 12 * 24 * 60 }), resolved: true },
]
