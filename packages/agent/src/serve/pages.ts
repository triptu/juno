/**
 * The Juno menu's pages (SPEC 13.10, plan v3 §13.3), built from the
 * agent's records. Plain functions over the store, like `chat.ts`; the
 * server decides when to rebuild.
 *
 * Each page shows what exists today and is empty where its records come
 * with a later work package:
 *
 * - What Juno remembers: the active pins, with their source message.
 * - Memory of this chat: the published memory view as a dated timeline.
 * - Activity: one row per run: who asked, when, how it ended, whether it
 *   read untrusted content, and its actions (`actions/activity.ts`). The
 *   folded read line is not built yet.
 * - Scheduled (WP19), Connections (WP17) and Review (WP21: there is no
 *   restore yet, so never recovery) are empty.
 */
import { limits, utf8Bytes } from '@juno/agent-memory'
import {
  chatCopy,
  type ActivityPage,
  type ActivityRun,
  type ChatMessageId,
  type Ending,
  type MemoryLine,
  type MemoryPage,
  type PinId,
  type RemembersPage,
  type ReviewPage,
  type RunId,
  type RunOutcome,
} from '@juno/agent-contract'
import { Revision } from '@juno/agent-cards'
import { activityActions } from '../actions/activity'
import type { Origin } from '../router/events'
import { parseOutput } from '../router/output'
import { view } from '../store/memory'
import type { Store } from '../store/store'

export interface PageWindow {
  readonly cursor?: string
  readonly limit: number
}

/** The newest `limit` rows before `cursor` (oldest first), and whether older rows remain. */
function windowed<T>(rows: ReadonlyArray<T>, id: (row: T) => string, window: PageWindow): { readonly rows: ReadonlyArray<T>; readonly moreAbove: boolean } {
  const end = window.cursor === undefined ? rows.length : rows.findIndex((row) => id(row) === window.cursor)
  const stop = end < 0 ? rows.length : end
  const start = Math.max(0, stop - window.limit)
  return { rows: rows.slice(start, stop), moreAbove: start > 0 }
}

/* What Juno remembers ------------------------------------------------------ */

export const emptyRemembers: ReturnType<typeof remembersPage> = { page: { pins: [], usedBytes: 0, budgetBytes: limits.pins }, revisions: [] }

export function remembersPage(store: Store): { readonly page: RemembersPage; readonly revisions: ReadonlyArray<{ readonly id: PinId; readonly revision: typeof Revision.Type }> } {
  const rows = store.db
    .prepare(
      `SELECT pins.id, pins.version, pins.kind, pins.text, pins.at, pins.source_id AS sourceId, messages.at AS sourceAt
       FROM pins LEFT JOIN messages ON messages.id = pins.source_id
       WHERE pins.active = 1 ORDER BY pins.at, pins.id`,
    )
    .all() as Array<{ id: string; version: number; kind: 'span' | 'owner'; text: string; at: number; sourceId: number; sourceAt: number | null }>
  return {
    page: {
      pins: rows.map((row) => ({
        id: row.id as PinId,
        text: row.text,
        ...(row.kind === 'span' && row.sourceAt !== null ? { source: { messageId: String(row.sourceId) as ChatMessageId, at: row.sourceAt } } : {}),
        at: row.at,
      })),
      usedBytes: rows.reduce((n, row) => n + utf8Bytes(row.text), 0),
      budgetBytes: limits.pins,
    },
    revisions: rows.map((row) => ({ id: row.id as PinId, revision: Revision.make(row.version) })),
  }
}

/* Memory of this chat ------------------------------------------------------ */

export function memoryPage(store: Store, window: PageWindow): MemoryPage {
  const memory = view(store)
  // Archive times follow when each message was written, not its id: a span's dates are its earliest and latest.
  const times = store.db.prepare('SELECT min(at) AS from_at, max(at) AS to_at FROM messages WHERE id >= ? AND id < ?')
  const spanOf = (from: number, to: number) => {
    const row = times.get(from, to) as { from_at: number | null; to_at: number | null }
    return { from: row.from_at ?? 0, to: row.to_at ?? 0 }
  }
  const lines = memory.lines.map((line): MemoryLine => {
    const key = line.kind === 'node' ? line.node.ref : line.key
    const span = { id: `${key.a}:${key.w}`, ...spanOf(key.a, key.a + key.w) }
    return line.kind === 'node' ? { _tag: 'line', ...span, text: line.node.text } : { _tag: 'masked', ...span }
  })
  const shown = windowed(lines, (line) => line.id, window).rows
  return { lines: shown, ...(memory.covered > 0 ? { coveredThrough: spanOf(0, memory.covered).to } : {}) }
}

/* Activity ----------------------------------------------------------------- */

const outcomeOf = (ending: Ending, quiet: boolean): RunOutcome => {
  switch (ending._tag) {
    case 'complete':
      return quiet ? 'stayedQuiet' : 'replied'
    case 'interrupted':
      return 'interrupted'
    case 'blocked':
      return 'blocked'
    case 'failed':
      return 'failed'
  }
}

/** A report's op is `report:<job>:<seq>:<event>`: the job's title names who asked. */
const whoOf = (store: Store, origin: Origin, opId: string): string => {
  if (origin === 'report') {
    const job = store.db.prepare('SELECT title FROM jobs WHERE id = ?').get(opId.split(':')[1] ?? '') as { title: string } | undefined
    if (job !== undefined) return job.title
  }
  return chatCopy.pages.activity.who[origin]
}

/** Runs that have ended; the live run shows in the chat. */
export function activityPage(store: Store, window: PageWindow): ActivityPage {
  const runs = store.db
    .prepare('SELECT id, op_id AS opId, origin, clean, started_at AS at, ending FROM runs WHERE ended_at IS NOT NULL ORDER BY started_at, id')
    .all() as Array<{ id: string; opId: string; origin: Origin; clean: number; at: number; ending: string }>
  const { rows, moreAbove } = windowed(runs, (run) => run.id, window)
  const said = store.db.prepare("SELECT text FROM messages WHERE kind = 'juno' AND origin_op = ? ORDER BY id")
  return {
    runs: rows.map((run): ActivityRun => {
      const text = (said.all(run.opId) as Array<{ text: string }>).map((row) => row.text).join('\n\n')
      return {
        id: run.id as RunId,
        who: whoOf(store, run.origin, run.opId),
        at: run.at,
        outcome: outcomeOf(JSON.parse(run.ending) as Ending, parseOutput(text).bubbles.length === 0),
        actions: activityActions(store, run.id),
        tainted: run.clean === 0,
      }
    }),
    moreAbove,
  }
}

/* Review ------------------------------------------------------------------- */

/** Restore from backup comes with WP21, so this Mac is never in recovery yet. */
export const reviewPage = (): { readonly page: ReviewPage; readonly cards: readonly [] } => ({ page: { pending: [] }, cards: [] })
