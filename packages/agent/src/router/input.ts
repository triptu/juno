/**
 * What the model reads for an inbox op (plan v3 §8). The owner's words are
 * kept as written in the inbox; the model reads them wrapped, with a handle
 * it can reply or react to:
 *
 *   <message id="n12">also lunch at 1</message>
 *   <message id="n13"><quote from="juno">The deploy is green on staging.</quote>which deploy?</message>
 *   <reaction id="n14" emoji="🎉"><quote from="juno">The deploy is green on staging.</quote></reaction>
 *   <message id="n15"><about topic="T1" title="Postgres 16 plan" channel="#eng" kind="thread"/>is this settled?</message>
 *
 * A reply or reaction carries the item it points at in full, so "this one"
 * is never a guess. The archive keeps what the model read, so memory sees
 * the same thing. Reports, wakes and clicks are not wrapped. The owner's
 * words are not escaped: they stay byte for byte, so a pin can point at
 * them (`ownerWords`). A message sent from the Juno panel or with an About
 * chip carries what it is about first; its names and the selection are
 * Slack's, so they are escaped.
 */
import type { ReplyTarget, SendContext } from '@juno/agent-contract'
import type { InboxOp } from '../inbox/inbox'
import type { Store } from '../store/store'
import { parseOutput } from './output'

export const handleOf = (seq: number) => `n${seq}`

/** The owner op a handle names (`n12`), if it is an owner message. */
export function ownerOpOf(store: Store, handle: string): string | undefined {
  const seq = /^n(\d+)$/.exec(handle)?.[1]
  if (seq === undefined) return undefined
  const row = store.db.prepare("SELECT op_id AS opId FROM inbox WHERE seq = ? AND kind IN ('send', 'steer', 'retry')").get(Number(seq)) as
    | { opId: string }
    | undefined
  return row?.opId
}

/** What a send's or a reaction's `data` holds. */
export type InputData =
  | { readonly replyTo?: ReplyTarget; readonly context?: SendContext }
  | { readonly target: Extract<ReplyTarget, { _tag: 'bubble' | 'card' }>; readonly emoji: string }

/**
 * Juno's text in one run, as the archive holds it: its `juno` rows, one pi
 * entry after another. Parsing it gives the run's bubbles in order.
 */
export function runText(store: Store, runId: string): string {
  const rows = store.db
    .prepare(
      `SELECT text, entry_id AS entry, incarnation FROM messages
       WHERE kind = 'juno' AND redacted_gen IS NULL AND origin_op IN (SELECT op_id FROM run_inputs WHERE run_id = ?) ORDER BY id`,
    )
    .all(runId) as Array<{ text: string; entry: number; incarnation: string }>
  const entries: string[] = []
  let last: string | undefined
  for (const row of rows) {
    const key = `${row.incarnation}/${row.entry}`
    if (key === last) entries[entries.length - 1] += row.text
    else entries.push(row.text)
    last = key
  }
  return entries.join('\n\n')
}

/** A bubble's text from the archive: `<runId>:<n>`. */
export function archivedBubble(store: Store, id: string): string | undefined {
  const at = id.lastIndexOf(':')
  if (at < 0) return undefined
  return parseOutput(runText(store, id.slice(0, at))).bubbles[Number(id.slice(at + 1))]?.text
}

function quote(store: Store, target: ReplyTarget, bubble: (id: string) => string | undefined): string {
  switch (target._tag) {
    case 'bubble': {
      const text = bubble(target.id)
      return text === undefined ? '<quote from="juno" removed="true"></quote>' : `<quote from="juno">${text}</quote>`
    }
    case 'card':
      // Cards are stored from WP15; until then the model knows only that it was a card.
      return `<quote card="${target.id}"></quote>`
    case 'owner': {
      const row = store.db.prepare('SELECT text FROM inbox WHERE op_id = ?').get(target.opId) as { text: string } | undefined
      return row === undefined ? '<quote from="owner" removed="true"></quote>' : `<quote from="owner">${row.text}</quote>`
    }
  }
}

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const placeName = (place: { readonly name: string; readonly tint: string }) => (place.tint === 'dm' ? place.name : `#${place.name}`)

/** The `<about>` element for a send's context. */
export function aboutElement(context: SendContext): string {
  switch (context._tag) {
    case 'person':
      return `<about person="${escape(context.userId)}" name="${escape(context.name)}"/>`
    case 'channel':
      return `<about channel="${escape(context.place.channelId)}" name="${escape(placeName(context.place))}"/>`
    case 'topic': {
      const attributes = [
        `topic="${escape(context.topicId)}"`,
        `title="${escape(context.title)}"`,
        `channel="${escape(placeName(context.place))}"`,
        `channel-id="${escape(context.place.channelId)}"`,
        `kind="${context.kind}"`,
        ...(context.visible ? [`visible="${escape(context.visible.from)}..${escape(context.visible.to)}"`] : []),
        ...(context.newFrom ? [`new-from="${escape(context.newFrom)}"`] : []),
      ].join(' ')
      if (context.selection === undefined) return `<about ${attributes}/>`
      const from = context.selection.sender === undefined ? '' : ` from="${escape(context.selection.sender)}"`
      return `<about ${attributes}><selection${from}>${escape(context.selection.text)}</selection></about>`
    }
  }
}

/** Whether a send carries topic content (its title, its selection): Slack content, so the run is no longer clean (SPEC 7, 13.9). */
export function readsTopic(op: InboxOp): boolean {
  if (op.data === null) return false
  const data = JSON.parse(op.data) as InputData
  return 'context' in data && data.context?._tag === 'topic'
}

/** The text pi receives for `op`. `bubble` finds a bubble's text, live or archived. */
export function modelText(store: Store, op: InboxOp, bubble: (id: string) => string | undefined): string {
  const data = (op.data === null ? {} : JSON.parse(op.data)) as InputData
  const id = handleOf(op.seq)
  switch (op.kind) {
    case 'send':
    case 'steer':
    case 'retry': {
      const about = 'context' in data && data.context !== undefined ? aboutElement(data.context) : ''
      const replyTo = 'replyTo' in data && data.replyTo !== undefined ? quote(store, data.replyTo, bubble) : ''
      return `<message id="${id}">${about}${replyTo}${op.text}</message>`
    }
    case 'react': {
      const reaction = data as Extract<InputData, { emoji: string }>
      return `<reaction id="${id}" emoji="${reaction.emoji}">${quote(store, reaction.target, bubble)}</reaction>`
    }
    default:
      return op.text
  }
}

const OPEN = /^<message id="n\d+">(?:<about[^>]*\/>|<about[^>]*>[\s\S]*?<\/about>)?(?:<quote[^>]*>[\s\S]*?<\/quote>)?/
const CLOSE = '</message>'

/**
 * The byte range of the owner's own words in an archive `user` row: inside
 * the `<message>` wrapper and after any quote. A reaction row has none, so a
 * reaction can never become a pin. A row that is not wrapped is all words.
 */
export function ownerWords(text: string): { readonly from: number; readonly to: number } {
  if (text.startsWith('<reaction ')) return { from: 0, to: 0 }
  const open = OPEN.exec(text)?.[0] ?? ''
  const to = Buffer.byteLength(text, 'utf8') - (open !== '' && text.endsWith(CLOSE) ? CLOSE.length : 0)
  return { from: Buffer.byteLength(open, 'utf8'), to }
}
