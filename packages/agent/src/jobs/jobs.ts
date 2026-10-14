/**
 * The job runner (plan v3 §8, §11.2; agent-cards `transitionJob`). Jobs run
 * beside the chat and never use the status bubble: each has a Task card
 * under the message that started it, with its phase and a live state line,
 * and only the card's Stop ends it (B5).
 *
 * A driver runs one kind of job and reports updates. The runner keeps the
 * phase machine and posts a report into the inbox on each milestone: a
 * question, done, failed, or quiet for 30 minutes after the last step
 * change. The router makes it a steer of the live run, or a new run.
 *
 * A report is accepted into the inbox before the job's phase moves, as
 * `report:<job>:<seq>:<event>`. A crash in between leaves the job in its old
 * phase; when it runs again it posts the same op, which the inbox takes
 * once, and a different milestone gets its own op.
 *
 * At startup, a job that was running starts again if its driver can resume
 * it, and is `unknown` otherwise (§6.5).
 */
import { transitionJob, type JobEvent } from '@juno/agent-cards'
import type { JobPhase } from '@juno/agent-contract'
import type { Accept } from '../inbox/inbox'
import { transaction } from '../store/database'
import { uuidv7, type Store } from '../store/store'

/** §8: a job with no step change for this long posts the quiet milestone once. */
export const QUIET_MS = 30 * 60 * 1000

export type JobKind = 'subagent' | 't3'

export interface Job {
  readonly id: string
  readonly kind: JobKind
  readonly runId: string
  readonly originOp: string
  readonly title: string
  readonly place: string
  readonly task: string
  readonly phase: JobPhase
  readonly state: string | null
  readonly stepAt: number
}

export interface JobUpdate {
  readonly event: JobEvent
  /** The live line under the card's title. */
  readonly state?: string
  /** Posted as a report on a milestone. */
  readonly report?: string
}

export interface JobDriver {
  readonly kind: JobKind
  /** Runs the job until it settles, or until `signal` aborts (the card's Stop). Resolves with its last update. */
  readonly run: (job: Job, signal: AbortSignal, update: (update: JobUpdate) => void) => Promise<JobUpdate>
  /** Whether a job left running by the last process can run again. */
  readonly resumable: boolean
  /** The quiet milestone's report. */
  readonly quiet?: (job: Job) => string
}

export interface JobsOptions {
  readonly store: Store
  readonly drivers: ReadonlyArray<JobDriver>
  /** The router's accept: a report is inbox input. */
  readonly accept: (input: { readonly opId: string; readonly kind: 'report'; readonly text: string }) => Accept
  readonly quietMs?: number
  readonly onReport?: (error: unknown) => void
  readonly onChange?: (job: Job) => void
}

type Row = { id: string; kind: JobKind; run_id: string; origin_op: string; title: string; place: string; task: string; phase: JobPhase; state: string | null; step_at: number }
const jobOf = (row: Row): Job => ({
  id: row.id, kind: row.kind, runId: row.run_id, originOp: row.origin_op, title: row.title, place: row.place, task: row.task,
  phase: row.phase, state: row.state, stepAt: row.step_at,
})
const settled = (phase: JobPhase) => phase === 'done' || phase === 'failed' || phase === 'stopped' || phase === 'unknown'

export function createJobs(options: JobsOptions) {
  const { store } = options
  const quietMs = options.quietMs ?? QUIET_MS
  const running = new Map<string, { readonly controller: AbortController; readonly done: Promise<void>; quietTimer?: ReturnType<typeof setTimeout> }>()
  let closed = false

  const get = (id: string) => {
    const row = store.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
    return row === undefined ? undefined : jobOf(row)
  }

  const apply = (id: string, update: JobUpdate) => {
    const before = get(id)
    if (before === undefined) return
    const phase = transitionJob(before.phase, update.event)
    const stepped = update.event === 'progress' && update.state !== undefined && update.state !== before.state
    const reporting = update.report !== undefined && phase !== before.phase
    if (reporting) {
      const seq = (store.db.prepare('SELECT reports FROM jobs WHERE id = ?').get(id) as { reports: number }).reports + 1
      options.accept({ opId: `report:${id}:${seq}:${update.event}`, kind: 'report', text: update.report! })
    }
    transaction(store.db, () => {
      store.db
        .prepare('UPDATE jobs SET phase = ?, state = ?, step_at = ?, ended_at = ?, reports = reports + ? WHERE id = ?')
        .run(phase, update.state ?? before.state, stepped || phase !== before.phase ? store.now() : before.stepAt, settled(phase) ? store.now() : null, reporting ? 1 : 0, id)
    })
    const after = get(id)!
    options.onChange?.(after)
    watchQuiet(after)
  }

  const watchQuiet = (job: Job) => {
    const entry = running.get(job.id)
    if (entry === undefined) return
    if (entry.quietTimer !== undefined) clearTimeout(entry.quietTimer)
    entry.quietTimer = undefined
    if (job.phase !== 'running') return
    const driver = options.drivers.find((d) => d.kind === job.kind)
    if (driver?.quiet === undefined) return
    entry.quietTimer = setTimeout(() => apply(job.id, { event: 'quiet', report: driver.quiet!(get(job.id)!) }), Math.max(0, job.stepAt + quietMs - store.now()))
  }

  const launch = (job: Job) => {
    const driver = options.drivers.find((d) => d.kind === job.kind)
    if (driver === undefined || closed) return apply(job.id, { event: 'unknown' })
    const controller = new AbortController()
    const done = driver
      .run(job, controller.signal, (update) => apply(job.id, update))
      .then(
        (last) => {
          // At shutdown the job is left running; the next launch resumes it.
          if (!closed) apply(job.id, controller.signal.aborted ? { event: 'cancelled' } : last)
        },
        (error: unknown) => {
          if (closed) return
          options.onReport?.(error)
          apply(job.id, controller.signal.aborted ? { event: 'cancelled' } : { event: 'failed', report: `${job.title} failed.` })
        },
      )
      .finally(() => {
        const entry = running.get(job.id)
        if (entry?.quietTimer !== undefined) clearTimeout(entry.quietTimer)
        running.delete(job.id)
      })
    running.set(job.id, { controller, done })
    watchQuiet(job)
  }

  return {
    /** Starts a job for a tool call; the same call gets the same job. */
    start: (input: { readonly kind: JobKind; readonly runId: string; readonly originOp: string; readonly callId: string; readonly title: string; readonly place: string; readonly task: string }): Job => {
      const existing = store.db.prepare('SELECT * FROM jobs WHERE call_id = ?').get(input.callId) as Row | undefined
      if (existing !== undefined) return jobOf(existing)
      const id = uuidv7(store.now())
      transaction(store.db, () => {
        store.db
          .prepare(
            "INSERT INTO jobs (id, kind, run_id, origin_op, call_id, title, place, task, phase, step_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)",
          )
          .run(id, input.kind, input.runId, input.originOp, input.callId, input.title, input.place, input.task, store.now(), store.now())
      })
      const job = get(id)!
      options.onChange?.(job)
      launch(job)
      return job
    },
    /** The Task card's Stop. */
    stop: async (id: string) => {
      const job = get(id)
      if (job === undefined || settled(job.phase)) return
      apply(id, { event: 'stop' })
      const entry = running.get(id)
      if (entry === undefined) return apply(id, { event: 'cancelled' })
      entry.controller.abort()
      await entry.done
    },
    get,
    /** Every job, newest first. */
    list: (): ReadonlyArray<Job> => (store.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC, id DESC').all() as unknown as Row[]).map(jobOf),
    /** Jobs not yet settled, for turn state and the sidebar sparkle. */
    active: (): ReadonlyArray<Job> =>
      (store.db.prepare("SELECT * FROM jobs WHERE phase NOT IN ('done', 'failed', 'stopped', 'unknown') ORDER BY created_at").all() as unknown as Row[]).map(jobOf),
    /** Jobs the last process left running: resume them, or mark them unknown. */
    resume: () => {
      const open = store.db.prepare("SELECT * FROM jobs WHERE phase NOT IN ('done', 'failed', 'stopped', 'unknown')").all() as unknown as Row[]
      for (const row of open) {
        const job = jobOf(row)
        const driver = options.drivers.find((d) => d.kind === job.kind)
        if (job.phase === 'stopping') apply(job.id, { event: 'cancelled' })
        else if (driver?.resumable) launch(job)
        else apply(job.id, { event: 'unknown' })
      }
    },
    /** Resolves when no job runs. */
    idle: async () => {
      while (running.size > 0) await Promise.all([...running.values()].map((entry) => entry.done))
    },
    close: async () => {
      closed = true
      for (const entry of running.values()) {
        if (entry.quietTimer !== undefined) clearTimeout(entry.quietTimer)
        entry.controller.abort()
      }
      await Promise.all([...running.values()].map((entry) => entry.done))
    },
  }
}

export type Jobs = ReturnType<typeof createJobs>
