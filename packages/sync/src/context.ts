/**
 * What every sync step shares: who the user is, the config, and the small
 * in-memory queues that connect steps (roots to fetch, users to name).
 */
import type { Me } from '@juno/domain'
import type { Queue } from 'effect'
import type { SyncConfigShape } from './config'

export interface RootFetch {
  readonly channel: string
  readonly ts: string
}

export interface SyncContext {
  readonly me: Me
  readonly config: SyncConfigShape
  /** Roots the store only knows as stubs. A background fiber fetches them. */
  readonly rootFetches: Queue.Queue<RootFetch>
  /** Users whose name a preview needed and the users table lacked, with the topics to re-index once they arrive. */
  readonly missingUsers: Map<string, Set<string>>
  /**
   * Cold boot only: a thread discovered through history that the user does
   * not follow starts read at its latest reply, so a first boot does not light
   * up every old thread. Later discoveries start unread.
   */
  seedNewThreadsAsRead: boolean
}

/** `reindexTopics` options bound to a context: missing names are collected for the users step. */
export const reindexOptions = (ctx: SyncContext) => ({
  me: ctx.me,
  onMissingUser: (userId: string, topicId: string) => {
    let topics = ctx.missingUsers.get(userId)
    if (topics === undefined) {
      topics = new Set()
      ctx.missingUsers.set(userId, topics)
    }
    topics.add(topicId)
  },
})
