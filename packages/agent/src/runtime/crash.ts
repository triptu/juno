/**
 * The named crash points (plan v3 §16), owned by the agent runtime. Each sits between two transitions of
 * a Quint spec, named by the `label` the spec's state carries after each step,
 * so a failing crash test maps to a spec trace: replay the listed pair with a
 * `crash` command between `after` and `before`.
 */

export interface CrashPointSpec {
  readonly spec: 'agent-recovery.qnt' | 'agent-actions.qnt' | 'agent-memory.qnt'
  /** The transition that has just committed. */
  readonly after: string
  /** The transition that has not run. */
  readonly before: string
  /** Spec scenarios (`pure val` command lists) that crash here or next to here. */
  readonly scenarios: ReadonlyArray<string>
  /** What recovery must do, in the plan's words. */
  readonly expect: string
}

export const CRASH_POINTS = {
  'inbox.committed': {
    spec: 'agent-recovery.qnt', after: 'inbox', before: 'ack', scenarios: ['inboxPowerLoss'],
    expect: '§3: the op is in the inbox as accepted; the renderer may not have cleared it, and nothing was submitted.',
  },
  'bridge.reset': {
    spec: 'agent-recovery.qnt', after: 'reset', before: 'submit', scenarios: ['bridgeReplay'],
    expect: '§3: recovery resets again and submits with the same op_id; pi deduplicates, so the journal holds the op once.',
  },
  'bridge.submitted': {
    spec: 'agent-recovery.qnt', after: 'submit', before: 'submitted', scenarios: ['bridgeReplay', 'journalAheadStep'],
    expect: '§3: the journal is ahead of the inbox and the archive; recovery resumes and projection catches up.',
  },
  'approval.committed': {
    spec: 'agent-actions.qnt', after: 'click', before: 'authorize', scenarios: ['approvedDrain'],
    expect: '§6.3: the click is durable and nothing is authorized; the restarted agent authorizes it once and dispatches it.',
  },
  'authorization.consumed': {
    spec: 'agent-actions.qnt', after: 'authorize', before: 'send', scenarios: ['startupAttempt', 'authorityCrash (agent-recovery.qnt)'],
    expect: '§6.5: the consumed authorization has no receipt, so it is unknown before resume() and is never dispatched again.',
  },
  'attempt.beforeReceipt': {
    spec: 'agent-actions.qnt', after: 'accept', before: 'receipt', scenarios: ['negativeLookup', 'unknownRetry'],
    expect: '§6.3: the destination may have acted; the attempt is unknown until reconcile finds positive evidence.',
  },
  'rotation.drained': {
    spec: 'agent-recovery.qnt', after: 'project', before: 'rotate', scenarios: ['rotationIdentity'],
    expect: '§3 rotation: the old incarnation is still current; recovery reopens it and rotation runs again.',
  },
  'rotation.committed': {
    spec: 'agent-recovery.qnt', after: 'rotate', before: 'resume', scenarios: ['rotationIdentity'],
    expect: '§3 rotation: the new incarnation is committed and never reused; the old journal file may still exist and is deleted, not reopened.',
  },
  'redaction.deletionRaised': {
    spec: 'agent-recovery.qnt', after: 'raiseDeletion', before: 'redact', scenarios: ['deletionAheadStep', 'deletionOrder'],
    expect: '§14.4 (G13): the deletion record is ahead of the data and nothing is removed; the owner sees no "Removed" and can remove again, which commits once.',
  },
  'redaction.committed': {
    spec: 'agent-memory.qnt', after: 'redact', before: 'purge', scenarios: ['queueCurrent', 'localTaint'],
    expect: '§4.5: the tombstones, the masked view, the new gen and the revoked grants are durable; startup finishes the purge.',
  },
  'redaction.purged': {
    spec: 'agent-memory.qnt', after: 'purge', before: 'purge', scenarios: ['queueCurrent'],
    expect: '§4.5 step 3: the steps before this one are done; startup runs the rest, and running a done step again changes nothing.',
  },
  'backup.segmentWritten': {
    spec: 'agent-recovery.qnt', after: 'encrypt', before: 'manifest', scenarios: ['nonceAfterCrash', 'manifestBeforeSegment'],
    expect: '§14.4: the segment exists but no manifest names it; the next run uses a fresh nonce and the export cursor has not moved.',
  },
  'backup.manifestRenamed': {
    spec: 'agent-recovery.qnt', after: 'manifest', before: 'export', scenarios: ['exportCrash'],
    expect: '§14.4: the manifest is renamed but the export cursor is behind it; the next run re-exports, and the cursor never passes the manifest.',
  },
} as const satisfies Record<string, CrashPointSpec>

export type CrashPoint = keyof typeof CRASH_POINTS

/**
 * The agent reads this variable. The value is a point name, optionally with
 * the hit to crash on: `inbox.committed` crashes at the first hit,
 * `inbox.committed:3` at the third.
 */
export const CRASH_ENV = 'JUNO_AGENT_CRASH_AT'

/**
 * Called by the agent at each named point. If `JUNO_AGENT_CRASH_AT` names
 * the point (and this is the hit it names), the process kills itself with
 * SIGKILL, so nothing after the last commit runs, not even exit handlers.
 * `@juno/agent-testing` drives it.
 */
const hits = new Map<string, number>()
export function crashPoint(point: CrashPoint): void {
  const target = process.env[CRASH_ENV]
  if (!target) return
  const [name, nth = '1'] = target.split(':')
  if (name !== point) return
  const hit = (hits.get(point) ?? 0) + 1
  hits.set(point, hit)
  if (hit === Number(nth)) process.kill(process.pid, 'SIGKILL')
}
