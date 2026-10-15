/**
 * Slack links for a topic (research, slack-data-access "Permalinks"): no
 * API call. A thread links to its root message, Main to its channel.
 */
import type { TopicDetail } from '@juno/contract'

/** A thread's root ts from its topic id (`t:<channel>:<thread_ts>`, architecture 4.4); undefined for Main. */
export function threadRootTs(topicId: string): string | undefined {
  return topicId.startsWith('t:') ? topicId.slice(topicId.lastIndexOf(':') + 1) : undefined
}

export function slackLink(workspaceUrl: string, topic: Pick<TopicDetail, 'channel' | 'rootTs'>): string {
  const base = new URL(`archives/${topic.channel.id}`, workspaceUrl.endsWith('/') ? workspaceUrl : `${workspaceUrl}/`).toString()
  return topic.rootTs === undefined ? base : `${base}/p${topic.rootTs.replace('.', '')}`
}

/** A message's Slack link. A reply carries its thread, as Slack's own links do. */
export function messageLink(workspaceUrl: string, channel: string, ts: string, threadTs?: string): string {
  const url = new URL(`archives/${channel}/p${ts.replace('.', '')}`, workspaceUrl.endsWith('/') ? workspaceUrl : `${workspaceUrl}/`)
  if (threadTs !== undefined && threadTs !== ts) {
    url.searchParams.set('thread_ts', threadTs)
    url.searchParams.set('cid', channel)
  }
  return url.toString()
}
