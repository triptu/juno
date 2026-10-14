/**
 * Slack links for a topic (research, slack-data-access "Permalinks"): no
 * API call. A thread links to its root message, Main to its channel.
 */
import type { TopicDetail } from '@juno/contract'

export function slackLink(workspaceUrl: string, topic: Pick<TopicDetail, 'channel' | 'rootTs'>): string {
  const base = new URL(`archives/${topic.channel.id}`, workspaceUrl.endsWith('/') ? workspaceUrl : `${workspaceUrl}/`).toString()
  return topic.rootTs === undefined ? base : `${base}/p${topic.rootTs.replace('.', '')}`
}
