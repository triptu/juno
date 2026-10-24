/**
 * Sources on Slack claims (plan v3 §19.1). Each Slack message a read returns
 * in a run gets a short handle, `m1`, `m2`, …, in the order the run first
 * read it; the read result shows it, and the model cites it in a bubble as
 * `<src m="m3">words</src>`. A handle resolves against the current run's
 * table only, so a handle the model invents, or one from an earlier reply,
 * shows as plain text.
 *
 * The table is in `agent.sqlite`, so a run that resumes after a crash keeps
 * its handles, and a read that pi replays gets the same ones.
 */
import { transaction } from '../store/database'
import type { Store } from '../store/store'
import type { Span } from './output'

export interface SourceRef {
  readonly channelId: string
  readonly ts: string
  /** The channel as the owner sees it ("#eng"), when the host named it. */
  readonly place?: string
  /** A reply's thread root, so the source opens in its thread when this Mac has no copy. */
  readonly threadTs?: string
}

/** A bubble's text with each source resolved, or dropped when it names no message read in the run. */
export type BubbleSpan = { readonly text: string } | { readonly text: string; readonly source: SourceRef }

/** The handles of `messages` in run `runId`, giving each message not seen in the run yet the next one. */
export function assignHandles(store: Store, runId: string, messages: ReadonlyArray<SourceRef>): ReadonlyArray<string> {
  return transaction(store.db, () => {
    const known = store.db.prepare('SELECT handle FROM sources WHERE run_id = ? AND channel_id = ? AND ts = ?')
    const count = store.db.prepare('SELECT count(*) AS n FROM sources WHERE run_id = ?')
    const insert = store.db.prepare('INSERT INTO sources (run_id, handle, channel_id, ts, place, thread_ts) VALUES (?, ?, ?, ?, ?, ?)')
    return messages.map((m) => {
      const row = known.get(runId, m.channelId, m.ts) as { handle: string } | undefined
      if (row !== undefined) return row.handle
      const handle = `m${(count.get(runId) as { n: number }).n + 1}`
      insert.run(runId, handle, m.channelId, m.ts, m.place ?? null, m.threadTs ?? null)
      return handle
    })
  })
}

/** Run `runId`'s handle table. */
export function sourceTable(store: Store, runId: string): ReadonlyMap<string, SourceRef> {
  const rows = store.db.prepare('SELECT handle, channel_id AS channelId, ts, place, thread_ts AS threadTs FROM sources WHERE run_id = ?').all(runId) as Array<{
    handle: string
    channelId: string
    ts: string
    place: string | null
    threadTs: string | null
  }>
  return new Map(rows.map((r) => [r.handle, { channelId: r.channelId, ts: r.ts, ...(r.place === null ? {} : { place: r.place }), ...(r.threadTs === null ? {} : { threadTs: r.threadTs }) }]))
}

export function resolveSpans(spans: ReadonlyArray<Span>, table: ReadonlyMap<string, SourceRef>): ReadonlyArray<BubbleSpan> {
  return spans.map((span) => {
    const source = span.source === undefined ? undefined : table.get(span.source)
    return source === undefined ? { text: span.text } : { text: span.text, source }
  })
}
