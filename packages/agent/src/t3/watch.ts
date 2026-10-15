import { setTimeout } from 'node:timers/promises'
import type { Job, JobDriver } from '../jobs/jobs'
import type { McpManagerApi } from '../mcp/manager'
import { content, sessionOf, sessionBranch, threadState } from './protocol'

/** Resuming observes a recorded thread. It never launches or sends anything. */
export function t3Driver(manager: McpManagerApi, questions: (job: Job, threadId: string) => Promise<void>): JobDriver {
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
          if (branch !== undefined) manager.store.db.prepare('UPDATE jobs SET place = ? WHERE id = ?').run(`${session.project} · ${branch}`, job.id)
          const status = read.thread.status
          if (status === 'completed') return { event: 'done', state: 'Done', report: `T3 Code finished ${job.title}. Open session ${session.threadId} for the result.` }
          if (['failed', 'rolled_back'].includes(status)) return { event: 'failed', state: 'Failed', report: `T3 Code reported that ${job.title} failed.` }
          if (['interrupted', 'cancelled'].includes(status)) return { event: 'cancelled', state: 'Stopped' }
          if (status === 'waiting') await questions(job, session.threadId)
          update({ event: status === 'waiting' ? 'needsYou' : 'progress', state: status === 'waiting' ? 'T3 Code needs your answer' : 'T3 Code · running' })
          // Short polling also observes questions; thread_wait only wakes on completion on S8's server.
          await setTimeout(1000, undefined, { signal }).catch(() => undefined)
        } catch {
          update({ event: 'lostSight', state: manager.state('t3') === 'needsSignIn' ? 'Sign in to T3 Code to keep watching' : 'Cannot read this T3 Code session. Check the connection and tool schemas.' })
          await setTimeout(5000, undefined, { signal }).catch(() => undefined)
        }
      }
      return { event: 'cancelled' }
    },
  }
}
