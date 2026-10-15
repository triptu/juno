import { ChatMessageId, type MessageMenu, type ReplyTarget } from '@juno/agent-contract'
import { Revision } from '@juno/agent-cards'
import { parseOutput } from '../router/output'
import { ownerWords } from '../router/input'
import type { Store } from '../store/store'

type Row = { id: number; version: number; text: string; at: number; kind: string; op: string | null; entry: string }

/** Resolve the displayed message to the archive entry removal and pins operate on. */
export function messageMenu(store: Store, target: ReplyTarget): typeof MessageMenu.Type | null {
  if (target._tag === 'card') return null
  const columns = "id, version, text, at, kind, origin_op AS op, incarnation || '/' || entry_id AS entry"
  let row: Row | undefined
  if (target._tag === 'owner') {
    row = store.db.prepare(`SELECT ${columns} FROM messages WHERE origin_op = ? AND kind = 'user' AND redacted_gen IS NULL ORDER BY id LIMIT 1`).get(target.opId) as Row | undefined
  } else {
    const split = target.id.lastIndexOf(':')
    const run = target.id.slice(0, split)
    const index = Number(target.id.slice(split + 1))
    const rows = store.db.prepare(`SELECT ${columns} FROM messages WHERE kind = 'juno' AND redacted_gen IS NULL AND origin_op IN (SELECT op_id FROM run_inputs WHERE run_id = ?) ORDER BY id`).all(run) as Row[]
    let count = 0
    for (let i = 0; i < rows.length;) {
      const first = rows[i]!
      let text = ''
      while (i < rows.length && rows[i]!.entry === first.entry) text += rows[i++]!.text
      count += parseOutput(text).bubbles.length
      if (index < count) { row = first; break }
    }
  }
  if (row === undefined) return null
  const reply = row.kind === 'user' ? store.db.prepare("SELECT id FROM messages WHERE origin_op = ? AND kind = 'juno' AND id > ? AND redacted_gen IS NULL ORDER BY id LIMIT 1").get(row.op, row.id) as { id: number } | undefined : undefined
  const words = ownerWords(row.text)
  const preview = row.kind === 'user' ? Buffer.from(row.text).subarray(words.from, words.to).toString() : parseOutput(row.text).bubbles.map((bubble) => bubble.text).join('\n')
  const messageId = ChatMessageId.make(String(row.id))
  return { messageId, revision: Revision.make(row.version), sheet: { messages: [{ messageId, preview: preview.split('\n')[0] ?? '', at: row.at }], ...(reply ? { offerReply: ChatMessageId.make(String(reply.id)) } : {}) } }
}
