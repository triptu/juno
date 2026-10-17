/**
 * The run log behind Activity (SPEC 13.9): each tool call a run made, and
 * the model requests it spent. Nothing here changes what the model is sent;
 * the router writes a step from pi's tool hooks and `open.ts` adds usage
 * from the guard's call log.
 *
 * A step keeps the call's arguments, cut short, and a result in a shape
 * that holds none of what Juno read: a read's result is at most counted by
 * its tool (`ToolOutput.summary`), never kept, so Slack and connection
 * content stays in the journal and the archive, where a removal already
 * reaches it.
 */
import { transaction } from '../store/database'
import type { Store } from '../store/store'

/** The longest arguments or result a step keeps, in characters. */
export const STEP_TEXT_MAX = 240

export const clip = (text: string, max = STEP_TEXT_MAX): string => {
  const flat = text.replaceAll(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

export interface StepStart {
  readonly runId: string
  readonly callId: string
  readonly tool: string
  readonly args: unknown
}

export interface StepEnd {
  readonly runId: string
  readonly callId: string
  /** The result's text parts, joined. */
  readonly text: string
  readonly isError: boolean
  /** The tool reads untrusted content: its result is never kept. */
  readonly reads: boolean
  /** What the tool counted for the run log ("12 messages"), if it did. */
  readonly summary?: string
}

/** What a step keeps of a result: an error's text, the tool's count, or the first line of Juno's own text. A read's text is never kept. */
export function resultShape(end: Pick<StepEnd, 'text' | 'isError' | 'reads' | 'summary'>): string | null {
  if (end.isError) return clip(end.text)
  if (end.summary !== undefined) return clip(end.summary)
  if (end.reads) return null
  return clip(end.text.split('\n')[0] ?? '')
}

export function stepLog(store: Store) {
  const insert = store.db.prepare(
    `INSERT OR IGNORE INTO run_steps (run_id, call_id, seq, tool, args, outcome, started_at)
     VALUES (?, ?, (SELECT count(*) FROM run_steps WHERE run_id = ?), ?, ?, 'running', ?)`,
  )
  const end = store.db.prepare("UPDATE run_steps SET outcome = ?, detail = ?, ended_at = ? WHERE run_id = ? AND call_id = ? AND outcome = 'running'")
  const usage = store.db.prepare(
    `INSERT INTO run_usage (run_id, model, name, requests, cost) VALUES (?, ?, ?, 1, ?)
     ON CONFLICT (run_id, model) DO UPDATE SET requests = requests + 1,
       cost = CASE WHEN run_usage.cost IS NULL OR excluded.cost IS NULL THEN NULL ELSE run_usage.cost + excluded.cost END`,
  )
  return {
    started: (step: StepStart): void => {
      const args = clip(typeof step.args === 'string' ? step.args : JSON.stringify(step.args ?? {}))
      transaction(store.db, () => {
        insert.run(step.runId, step.callId, step.runId, step.tool, args, store.now())
      })
    },
    ended: (step: StepEnd): void => {
      transaction(store.db, () => {
        end.run(step.isError ? 'failed' : 'done', resultShape(step), store.now(), step.runId, step.callId)
      })
    },
    /** A chat request the guard finished, for the run that made it. */
    request: (runId: string, call: { readonly model: string; readonly name: string; readonly costUsd: number | null }): void => {
      transaction(store.db, () => {
        usage.run(runId, call.model, call.name, call.costUsd)
      })
    },
  }
}

export type StepLog = ReturnType<typeof stepLog>
