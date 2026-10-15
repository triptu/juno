/**
 * The hours-start summary in the chat (SPEC 14, plan v3 §19.1). The host
 * offers each summary until the agent says it took it; the agent writes it
 * to `chat_summaries` and the chat shows it as one Juno message with origin
 * `summary`, one source per message. No run, no model call, no spend.
 */
import type { HostSummary, JunoInline } from '@juno/agent-contract'
import type { Store } from '../store/store'

export interface SummaryRow {
  readonly id: string
  readonly at: number
  readonly title: string
  readonly sources: string
}

type Source = HostSummary['sources'][number]

/** Writes the summary once; a repeat is a no-op. True when it is new: the caller wakes the chat (`invalidateChatCaches`). */
export function appendSummary(store: Store, summary: HostSummary): boolean {
  const sources = JSON.stringify(summary.sources.map(({ channelId, ts, place, sender }) => ({ channelId, ts, place, ...(sender === undefined ? {} : { sender }) })))
  const added = store.db.prepare('INSERT OR IGNORE INTO chat_summaries (id, at, title, sources) VALUES (?, ?, ?, ?)').run(summary.id, summary.at, summary.title, sources)
  return Number(added.changes) > 0
}

/** "3 messages need you:", then one line per message whose words open it: "Maya Chen in #eng", or the place alone. */
export function summaryBody(row: SummaryRow): ReadonlyArray<JunoInline> {
  const sources = JSON.parse(row.sources) as ReadonlyArray<Source>
  return [
    { _tag: 'text', text: `${row.title}:` },
    ...sources.flatMap((source): ReadonlyArray<JunoInline> => [
      { _tag: 'text', text: '\n' },
      { _tag: 'source', text: source.sender === undefined ? source.place : `${source.sender} in ${source.place}`, channelId: source.channelId, ts: source.ts, place: source.place },
    ]),
  ]
}
