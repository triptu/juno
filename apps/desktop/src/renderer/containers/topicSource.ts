/**
 * Where the topic actions and menus read a topic: the header's detail when it is loaded, else the sidebar or All
 * topics row (`topicActions.ts`, `notifyActions.ts`).
 */
import type { TopicDetail } from '@juno/contract'
import { allTopicsRowAtom, registry, sidebarRowAtom, threadRootTs, topicAtom } from '@juno/state'

/** What the actions read from a sidebar row or the header's detail. Copy Slack link and Open in Slack need the detail's root. */
export type ActionTopic = Pick<TopicDetail, 'id' | 'kind' | 'title' | 'channel' | 'unreadCount' | 'pinned' | 'resolved' | 'subscribed'> & {
  readonly rootTs?: string | undefined
}

export const headerOf = (id: string): ActionTopic | undefined => {
  const header = registry.get(topicAtom(id))
  return header._tag === 'Success' && header.value !== null ? header.value : undefined
}

export const rowOf = (id: string): ActionTopic | undefined => {
  const row = registry.get(sidebarRowAtom(id)) ?? registry.get(allTopicsRowAtom(id))
  return row === undefined ? undefined : { ...row, rootTs: threadRootTs(id) }
}

/** The header's detail when it is loaded, else the sidebar or All topics row, with its thread's root from the id. */
export function topicOf(id: string): ActionTopic | undefined {
  return headerOf(id) ?? rowOf(id)
}

/**
 * Calls `changed` whenever what `topicOf` reads changes; returns the unsubscribe. It watches the sidebar's row, which
 * a follow adds, and the header's detail and All topics' row only while they are loaded, so it starts no query.
 */
export function watchTopic(id: string, changed: () => void): () => void {
  const stops = [registry.subscribe(sidebarRowAtom(id), changed)]
  if (headerOf(id) !== undefined) stops.push(registry.subscribe(topicAtom(id), changed))
  // As `rowOf` reads it: All topics only when the sidebar has no row.
  if (registry.get(sidebarRowAtom(id)) === undefined && registry.get(allTopicsRowAtom(id)) !== undefined) stops.push(registry.subscribe(allTopicsRowAtom(id), changed))
  return () => { for (const stop of stops) stop() }
}
