import type { Message, ThreadCounts } from '@juno/slack-schema'
import { compareTs } from '@juno/slack-schema'
import type { Subscription, Workspace } from './state.ts'

interface Thread {
  readonly sub: Subscription
  root?: Message
  readonly replies: Message[]
}

/** One request-local index; mutations between pages are always visible. */
export function threadIndex(workspace: Workspace): ReadonlyArray<Thread> {
  const channels = new Map<string, Map<string, Thread>>()
  const threads: Thread[] = []
  for (const sub of workspace.subscriptions.values()) {
    if (!sub.subscribed) continue
    let channel = channels.get(sub.channel)
    if (channel === undefined) { channel = new Map(); channels.set(sub.channel, channel) }
    const thread: Thread = { sub, replies: [] }
    channel.set(sub.threadTs, thread)
    threads.push(thread)
  }
  for (const [channel, index] of channels) {
    for (const message of workspace.messages.get(channel) ?? []) {
      if (message.thread_ts !== undefined && message.thread_ts !== message.ts) {
        index.get(message.thread_ts)?.replies.push(message)
      }
      const thread = index.get(message.ts)
      if (thread !== undefined) thread.root = message
    }
  }
  return threads
}

/** Reuses getView's index instead of scanning all messages a second time. */
export function threadCounts(workspace: Workspace, threads = threadIndex(workspace)): Omit<ThreadCounts, 'timestamp'> {
  const unreadByChannel: Record<string, number> = {}
  const mentionsByChannel: Record<string, number> = {}
  for (const { sub, replies } of threads) {
    for (const message of replies) {
      if (message.user === workspace.selfId || compareTs(message.ts, sub.lastRead) <= 0) continue
      unreadByChannel[sub.channel] = (unreadByChannel[sub.channel] ?? 0) + 1
      if (workspace.mentionsSelf(message)) mentionsByChannel[sub.channel] = (mentionsByChannel[sub.channel] ?? 0) + 1
    }
  }
  const mentionCount = Object.values(mentionsByChannel).reduce((a, b) => a + b, 0)
  return {
    has_unreads: Object.keys(unreadByChannel).length > 0,
    mention_count: mentionCount,
    mention_count_by_channel: mentionsByChannel,
    unread_count_by_channel: unreadByChannel,
  }
}
