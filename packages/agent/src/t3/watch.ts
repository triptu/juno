import { setTimeout } from 'node:timers/promises'
import type { Job, JobDriver } from '../jobs/jobs'
import type { proposeQuestions } from './questions'
import type { McpManagerApi } from '../mcp/manager'
import { content, sessionOf, sessionBranch, threadState } from './protocol'

/** The first read after a change comes this soon; each read that sees no change doubles the wait up to `IDLE_MS`. */
const FAST_MS = 1000
export const IDLE_MS = 10_000
const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'rolled_back', 'interrupted', 'cancelled'])

/** Wakes a session's watcher now, after Juno itself changed the session (an answer it sent). */
export interface T3Wakes {
  readonly wake: (threadId: string) => void
  readonly next: (threadId: string, signal: AbortSignal) => Promise<void>
}

export function t3Wakes(): T3Wakes {
  const waiting = new Map<string, Set<() => void>>()
  return {
    wake: (threadId) => {
      for (const resolve of waiting.get(threadId) ?? []) resolve()
    },
    next: (threadId, signal) => new Promise((resolve) => {
      const set = waiting.get(threadId) ?? new Set()
      waiting.set(threadId, set)
      const done = () => {
        set.delete(done)
        if (set.size === 0 && waiting.get(threadId) === set) waiting.delete(threadId)
        signal.removeEventListener('abort', done)
        resolve()
      }
      set.add(done)
      signal.addEventListener('abort', done, { once: true })
    }),
  }
}

/**
 * Resolves when the run ends, as `t3_thread_wait` reports it, or never. S8's server wakes it
 * only on a terminal state, not on a question, so it can only shorten the poll, not replace it.
 */
async function ended(manager: McpManagerApi, threadId: string, timeoutMs: number): Promise<void> {
  try {
    manager.tool('t3', 't3_thread_wait')
    const result = content(await manager.invoke('t3', 't3_thread_wait', { threadId, timeoutMs }))
    const status = typeof result === 'object' && result !== null && 'status' in result ? result.status : undefined
    if (typeof status === 'string' && TERMINAL.has(status)) return
  } catch { /* No wait tool, or it failed: the poll still reads the session. */ }
  return new Promise(() => undefined)
}

/** Resuming observes a recorded thread. It never launches or sends anything. */
export function t3Driver(manager: McpManagerApi, questions: (job: Job, threadId: string, signal: AbortSignal) => ReturnType<typeof proposeQuestions>, wakes: T3Wakes): JobDriver {
  return {
    kind: 't3', resumable: true,
    run: async (job, signal, update) => {
      const session = sessionOf(job.task)
      let seen: string | undefined
      let interval = FAST_MS
      /** Waits `ms`, or less when the run ends or Juno changes the session. */
      const pause = async (ms: number) => {
        const stop = new AbortController()
        const either = AbortSignal.any([signal, stop.signal])
        await Promise.race([
          setTimeout(ms, undefined, { signal: either }).catch(() => undefined),
          wakes.next(session.threadId, either),
          ended(manager, session.threadId, ms),
        ])
        stop.abort()
      }
      while (!signal.aborted) {
        if (manager.stored('t3').epoch !== session.epoch) return { event: 'unknown', state: 'The T3 Code account changed. Check the session in T3 Code.' }
        if (manager.state('t3') !== 'ready') {
          update({ event: 'lostSight', state: 'Sign in to T3 Code to keep watching' })
          seen = undefined
          await setTimeout(1000, undefined, { signal }).catch(() => undefined)
          continue
        }
        try {
          const read = threadState(content(await manager.invoke('t3', 't3_thread_read', { threadId: session.threadId })))
          if (signal.aborted) break
          const branch = await sessionBranch(manager, session.threadId) ?? (read.thread.threadId === session.threadId ? read.thread.branch ?? undefined : undefined)
          if (branch !== undefined) manager.store.db.prepare('UPDATE jobs SET place = ? WHERE id = ? AND place != ?').run(`${session.project} · ${branch}`, job.id, `${session.project} · ${branch}`)
          if (signal.aborted) break
          if (read.thread.threadId === session.threadId && read.thread.linkedPullRequest !== undefined) {
            const task = JSON.stringify({ ...session, pullRequest: read.thread.linkedPullRequest ?? undefined })
            manager.store.db.prepare('UPDATE jobs SET task = ? WHERE id = ? AND task != ?').run(task, job.id, task)
          }
          const status = read.thread.status
          if (status === 'completed') return { event: 'done', state: 'Done', report: `T3 Code finished ${job.title}. Open session ${session.threadId} for the result.` }
          if (['failed', 'rolled_back'].includes(status)) return { event: 'failed', state: 'Failed', report: `T3 Code reported that ${job.title} failed.` }
          if (['interrupted', 'cancelled'].includes(status)) return { event: 'cancelled', state: 'Stopped' }
          let pending: ReadonlyArray<string> = []
          if (status === 'waiting') {
            const { shown, requestIds } = await questions(job, session.threadId, signal)
            if (signal.aborted) break
            pending = requestIds
            for (const requestId of requestIds.length ? requestIds : [undefined]) update({
              ...(requestId === undefined ? {} : { reportKey: `question:${requestId}` }),
              event: 'needsYou', state: shown ? 'T3 Code needs your answer' : 'T3 Code needs your answer in T3 Code',
              report: `T3 Code is waiting for an answer in ${job.title}. ${shown ? 'The question is on a Question card.' : 'Juno cannot show this question; the owner answers it in T3 Code.'}`,
            })
          } else update({ event: 'progress', state: 'T3 Code · running' })
          // A session that just changed is read again soon; one that stays the same is read less often.
          const now = JSON.stringify([status, branch, read.thread.linkedPullRequest, pending])
          interval = now === seen ? Math.min(interval * 2, IDLE_MS) : FAST_MS
          seen = now
          await pause(interval)
        } catch {
          update({ event: 'lostSight', state: manager.state('t3') === 'needsSignIn' ? 'Sign in to T3 Code to keep watching' : 'Cannot read this T3 Code session. Check the connection and tool schemas.' })
          seen = undefined
          await setTimeout(5000, undefined, { signal }).catch(() => undefined)
        }
      }
      return { event: 'cancelled' }
    },
  }
}
