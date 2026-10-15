import { setTimeout } from 'node:timers/promises'
import type { Job, JobDriver } from '../jobs/jobs'
import type { McpManagerApi } from '../mcp/manager'
import { content, sessionOf, sessionBranch, threadState } from './protocol'

/** Resuming observes a recorded thread. It never launches or sends anything. */
export function t3Driver(manager: McpManagerApi, questions: (job: Job, threadId: string, signal: AbortSignal) => Promise<boolean>): JobDriver {
  return {
    kind: 't3', resumable: true,
    run: async (job, signal, update) => {
      const session = sessionOf(job.task)
      while (!signal.aborted) {
        if (manager.stored('t3').epoch !== session.epoch) return { event: 'unknown', state: 'The T3 Code account changed. Check the session in T3 Code.' }
        if (manager.state('t3') !== 'ready') {
          update({ event: 'lostSight', state: 'Sign in to T3 Code to keep watching' })
          await setTimeout(1000, undefined, { signal }).catch(() => undefined)
          continue
        }
        try {
          const read = threadState(content(await manager.invoke('t3', 't3_thread_read', { threadId: session.threadId })))
          if (signal.aborted) break
          const branch = await sessionBranch(manager, session.threadId) ?? (read.thread.threadId === session.threadId ? read.thread.branch ?? undefined : undefined)
          if (branch !== undefined) manager.store.db.prepare('UPDATE jobs SET place = ? WHERE id = ? AND place != ?').run(`${session.project} · ${branch}`, job.id, `${session.project} · ${branch}`)
          if (signal.aborted) break
          const status = read.thread.status
          if (status === 'completed') return { event: 'done', state: 'Done', report: `T3 Code finished ${job.title}. Open session ${session.threadId} for the result.` }
          if (['failed', 'rolled_back'].includes(status)) return { event: 'failed', state: 'Failed', report: `T3 Code reported that ${job.title} failed.` }
          if (['interrupted', 'cancelled'].includes(status)) return { event: 'cancelled', state: 'Stopped' }
          if (status === 'waiting') {
            const shown = await questions(job, session.threadId, signal)
            // The report reaches Juno once per wait: the runner posts it only when the phase moves to needsYou.
            update({
              event: 'needsYou', state: shown ? 'T3 Code needs your answer' : 'T3 Code needs your answer in T3 Code',
              report: `T3 Code is waiting for an answer in ${job.title}. ${shown ? 'The question is on a Question card.' : 'Juno cannot show this question; the owner answers it in T3 Code.'}`,
            })
          } else update({ event: 'progress', state: 'T3 Code · running' })
          // Short polling also observes questions; thread_wait only wakes on completion on S8's server.
          await setTimeout(10_000, undefined, { signal }).catch(() => undefined)
        } catch {
          update({ event: 'lostSight', state: manager.state('t3') === 'needsSignIn' ? 'Sign in to T3 Code to keep watching' : 'Cannot read this T3 Code session. Check the connection and tool schemas.' })
          await setTimeout(5000, undefined, { signal }).catch(() => undefined)
        }
      }
      return { event: 'cancelled' }
    },
  }
}
