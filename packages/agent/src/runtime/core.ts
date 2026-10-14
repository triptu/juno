/**
 * The durable core (plan v3 §2.2, §3, §6.5): the owner lock, `agent.sqlite`,
 * recovery, the pi journal, the projection and a serial run loop.
 *
 * The run loop is the simplest router: while the mode is `on` and the
 * conversation is idle, it delivers the oldest accepted op through the
 * bridge, waits for its run to settle, catches the projection up and settles
 * the op. Steering, wakes and the request builder are WP11's router; it
 * replaces this loop and keeps the bridge.
 *
 * Shutdown follows G9: the loop stops, pi closes (its writes stop), the
 * projection finishes, `agent.sqlite` closes, and only then is the owner
 * lock released.
 */
import { join } from 'node:path'
import { accept, nextAccepted, settle, unsettled, type Accept, type InboxKind } from '../inbox/inbox'
import { deliver } from '../inbox/bridge'
import { projector } from '../projection/projector'
import { commitRotation, currentIncarnation, deleteRetiredJournals } from '../recovery/incarnations'
import { recover } from '../recovery/recover'
import { openDatabase, StoreTooNew, type Database } from '../store/database'
import { mode, setMode, type JournalPosition, type Mode } from '../store/ledger'
import type { MigrationSet } from '../store/schema'
import { initialize, type Store } from '../store/store'
import { crashPoint } from './crash'
import { openJournalFile, type Journal, type JournalSettings } from './journal'
import { acquireOwnerLock } from './lock'

export const AGENT_DATABASE_FILE = 'agent.sqlite'
/** §3: the journal rotates monthly. */
export const ROTATION_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface CoreOptions extends JournalSettings {
  readonly agentDir: string
  /** Migration sets of other folders (spend, backup), applied after `core`. */
  readonly migrations?: ReadonlyArray<MigrationSet>
  readonly now?: () => number
}

/** "Juno needs to update its records": a newer Juno wrote `agent.sqlite` or the journal. Nothing runs. */
export interface UpdateNeeded {
  readonly _tag: 'updateNeeded'
  readonly close: () => Promise<void>
}

export interface Core {
  readonly _tag: 'running'
  readonly store: Store
  /** How the journal was found at open. */
  readonly opened: 'resumed' | 'rotated'
  readonly incarnation: () => string
  /** The journal's last commit now. A tool reads it inside `execute()` and passes it to `authorize`. */
  readonly position: () => Promise<JournalPosition>
  /** Writes the op to the inbox (FULL) before it returns. Accepting the same op again is a no-op. */
  readonly accept: (input: { readonly opId: string; readonly kind: InboxKind; readonly text: string; readonly data?: unknown }) => Accept
  readonly mode: () => Mode
  /** Pause, AI off and Resume (§6.5). Sends wait while paused; nothing new is authorized. */
  readonly setMode: (next: Mode) => void
  /** Rotates the journal once the current run settles (§3 Rotation). */
  readonly rotate: () => Promise<void>
  /** Resolves when no op is accepted or running (while `on`). */
  readonly idle: () => Promise<void>
  readonly close: () => Promise<void>
}

export async function openCore(options: CoreOptions): Promise<Core | UpdateNeeded> {
  const now = options.now ?? Date.now
  const lock = acquireOwnerLock(options.agentDir)
  let db: Database | undefined
  try {
    try {
      db = openDatabase(join(options.agentDir, AGENT_DATABASE_FILE), options.migrations ?? [], now)
    } catch (error) {
      if (error instanceof StoreTooNew) return updateNeeded(lock.release)
      throw error
    }
    const store: Store = { db, now }
    initialize(store)
    const recovery = await recover(store, options.agentDir)
    if (recovery._tag === 'updateNeeded') {
      db.close()
      return updateNeeded(lock.release)
    }
    const journal = await recovery.file.start(options)
    return running(store, journal, options, recovery._tag === 'resume' ? 'resumed' : 'rotated', () => {
      store.db.close()
      lock.release()
    })
  } catch (error) {
    if (db?.isOpen) db.close()
    lock.release()
    throw error
  }
}

function updateNeeded(release: () => void): UpdateNeeded {
  return { _tag: 'updateNeeded', close: async () => release() }
}

function running(store: Store, first: Journal, options: CoreOptions, opened: 'resumed' | 'rotated', release: () => void): Core {
  let journal = first
  let projection = projector(store, journal)
  let unsubscribe = journal.onCommit(() => void projection.catchUp())
  let closing = false
  let rotateRequested: Array<() => void> = []
  let current: string | undefined
  let wake: (() => void) | undefined
  const signal = () => wake?.()
  const idleWaiters: Array<() => void> = []

  const isIdle = () => current === undefined && (mode(store) !== 'on' || nextAccepted(store) === undefined)
  const notifyIdle = () => {
    if (!isIdle()) return
    for (const resolve of idleWaiters.splice(0)) resolve()
  }

  /** Waits for one submitted run, projects what it wrote, and settles its op. */
  const settleRun = async (opId: string, submissionId: string) => {
    current = opId
    const settled = await journal.wait(submissionId)
    await projection.catchUp()
    if (settled.status === 'done') settle(store, opId, 'done')
    else settle(store, opId, 'interrupted', settled.reason)
    current = undefined
  }

  const rotateNow = async () => {
    // Admissions are stopped (the loop is here, between runs). Drain the projection.
    await projection.catchUp()
    crashPoint('rotation.drained')
    const old = journal
    const incarnation = commitRotation(store, 'rotation')
    unsubscribe()
    await old.close()
    deleteRetiredJournals(options.agentDir, incarnation)
    const next = await openJournalFile(options.agentDir, incarnation)
    if (next._tag !== 'opened') throw new Error(`a new journal could not be opened (${next._tag})`)
    journal = await next.file.start(options)
    projection = projector(store, journal)
    unsubscribe = journal.onCommit(() => void projection.catchUp())
    journal.resume()
  }

  const rotationDue = () => {
    const row = store.db.prepare('SELECT created_at AS at FROM incarnations WHERE id = ?').get(journal.incarnation) as { at: number }
    return store.now() - row.at >= ROTATION_AGE_MS
  }

  const loop = async () => {
    // pi resumes runs the last process left; settle their ops first.
    for (const op of unsettled(store, journal.incarnation)) {
      if (closing) return
      await settleRun(op.opId, op.submissionId!)
    }
    await projection.catchUp()
    for (;;) {
      if (closing) return
      if (rotateRequested.length > 0 || rotationDue()) {
        const waiting = rotateRequested
        rotateRequested = []
        await rotateNow()
        for (const resolve of waiting) resolve()
        continue
      }
      const op = mode(store) === 'on' ? nextAccepted(store) : undefined
      if (op === undefined) {
        notifyIdle()
        await new Promise<void>((resolve) => (wake = resolve))
        continue
      }
      const submissionId = await deliver(store, journal, op, { steer: false })
      await settleRun(op.opId, submissionId)
    }
  }

  journal.resume()
  const done = loop().catch((error: unknown) => {
    // After close, pi rejects pending waits; the ops stay submitted and resume next time.
    if (!closing) options.onReport?.(error)
  })

  return {
    _tag: 'running',
    store,
    opened,
    incarnation: () => currentIncarnation(store)!,
    position: async () => ({ incarnation: journal.incarnation, seq: await journal.lastCommitted() }),
    accept: (input) => {
      const result = accept(store, input)
      signal()
      return result
    },
    mode: () => mode(store),
    setMode: (next) => {
      setMode(store, next)
      signal()
    },
    rotate: () =>
      new Promise<void>((resolve) => {
        rotateRequested.push(resolve)
        signal()
      }),
    idle: () =>
      new Promise<void>((resolve) => {
        idleWaiters.push(resolve)
        notifyIdle()
        signal()
      }),
    close: async () => {
      closing = true
      signal()
      unsubscribe()
      await projection.catchUp()
      await journal.close()
      await done
      release()
    },
  }
}
