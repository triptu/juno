/**
 * Juno's own record of every child call a codemode script made
 * (docs/research/codemode.md, "Audit"): its arguments before it runs, then
 * its outcome. pi keeps only the script's aggregate, so this is the record
 * Activity shows. A replayed script makes the same calls under the same ids,
 * so a row is written once and its outcome set once.
 */
import type { ActivityScriptCall } from '@juno/agent-contract'
import type { ScriptAudit, ScriptOutcome } from '../runtime/codemode'
import { transaction } from '../store/database'
import type { Store } from '../store/store'

/** `runId` is the live run's, read when the call starts. */
export function scriptAudit(store: Store, runId: () => string | undefined): ScriptAudit {
  return {
    started: ({ scriptId, callId, tool, args }) => {
      transaction(store.db, () => {
        store.db
          .prepare('INSERT OR IGNORE INTO script_calls (id, script_id, run_id, tool, args, outcome, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(callId, scriptId, runId() ?? null, tool, args, 'running', store.now())
      })
    },
    ended: (callId: string, outcome: ScriptOutcome, detail: string) => {
      transaction(store.db, () => {
        store.db
          .prepare("UPDATE script_calls SET outcome = ?, detail = ?, ended_at = ? WHERE id = ? AND outcome = 'running'")
          .run(outcome, detail, store.now(), callId)
      })
    },
  }
}

type Row = { script_id: string; tool: string; args: string; outcome: ScriptOutcome | 'running' }

/** A run's script calls for Activity, and their folded line. The run has ended, so a call still running did not finish. */
export function activityScripts(store: Store, runId: string): { readonly reads?: string; readonly scriptCalls?: ReadonlyArray<ActivityScriptCall> } {
  const rows = store.db.prepare('SELECT script_id, tool, args, outcome FROM script_calls WHERE run_id = ? ORDER BY started_at, id').all(runId) as Row[]
  if (rows.length === 0) return {}
  const scriptCalls = rows.map((row): ActivityScriptCall => ({ tool: row.tool, args: row.args, outcome: row.outcome === 'running' ? 'unfinished' : row.outcome }))
  const count = (outcome: ActivityScriptCall['outcome']) => scriptCalls.filter((call) => call.outcome === outcome).length
  const scripts = new Set(rows.map((row) => row.script_id)).size
  const reads = scriptCalls.length - count('refused')
  // "Ran 1 script: 4 reads, 1 cancelled".
  const tail = (['failed', 'cancelled', 'refused', 'unfinished'] as const).flatMap((o) => (count(o) > 0 ? [`${count(o)} ${o === 'unfinished' ? 'did not finish' : o}`] : []))
  return { reads: [`Ran ${plural(scripts, 'script')}: ${plural(reads, 'read')}`, ...tail].join(', '), scriptCalls }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
