/**
 * Context menu item lists (spec section 5, inventory section 15). The shell
 * turns these into native menus; the ids come back as actions.
 */
import { channelLabel, isDm, type ChannelInfo } from './channel'
import type { TopicKind } from './ids'

export type TopicMenuAction =
  | 'open-new-tab'
  | 'open-stealth'
  | 'rename'
  | 'use-ai-title'
  | 'mark-read'
  | 'mark-unread'
  | 'pin'
  | 'unpin'
  | 'subscribe'
  | 'unsubscribe'
  | 'resolve'
  | 'reopen'
  | 'copy-link'
  | 'ignore-channel'

export type ChannelMenuAction = 'show-topics' | 'open-main' | 'open-main-stealth' | 'mark-channel-read' | 'mark-channel-unread' | 'ignore-channel'

export type MenuItem<A extends string> =
  | { readonly type: 'item'; readonly id: A; readonly label: string; readonly hint?: string }
  | { readonly type: 'separator' }

export interface TopicMenuState {
  readonly kind: TopicKind
  readonly channel: ChannelInfo
  readonly unread: boolean
  readonly pinned: boolean
  readonly subscribed: boolean
  readonly resolved: boolean
  readonly hasManualTitle: boolean
  readonly hasAiTitle: boolean
  readonly aiAssist: boolean
}

const separator = { type: 'separator' } as const

function item<A extends string>(id: A, label: string, hint?: string): MenuItem<A> {
  return hint === undefined ? { type: 'item', id, label } : { type: 'item', id, label, hint }
}

/** The menu for a topic row, a topic tab and the header More button. */
export function topicMenuItems(state: TopicMenuState): ReadonlyArray<MenuItem<TopicMenuAction>> {
  const isMain = state.kind === 'main'
  const items: MenuItem<TopicMenuAction>[] = [
    item('open-new-tab', 'Open in new tab', '⌘ click'),
    item('open-stealth', 'Open in stealth', 'Stays unread'),
    separator,
  ]
  if (!isMain) items.push(item('rename', 'Rename'))
  if (!isMain && state.hasManualTitle && state.hasAiTitle && state.aiAssist) items.push(item('use-ai-title', 'Use AI title'))
  items.push(state.unread ? item('mark-read', 'Mark as read') : item('mark-unread', 'Mark as unread'))
  items.push(state.pinned ? item('unpin', 'Unpin') : item('pin', 'Pin'))
  items.push(state.subscribed ? item('unsubscribe', 'Unsubscribe') : item('subscribe', 'Subscribe'))
  items.push(state.resolved ? item('reopen', 'Reopen') : item('resolve', 'Resolve'))
  items.push(separator, item('copy-link', 'Copy Slack link'))
  if (!isDm(state.channel.kind)) items.push(item('ignore-channel', `Ignore ${channelLabel(state.channel)}`))
  return items
}

export interface ChannelMenuState {
  readonly channel: ChannelInfo
  readonly hasMain: boolean
}

/** The menu for a channel row in Browse. */
export function channelMenuItems(state: ChannelMenuState): ReadonlyArray<MenuItem<ChannelMenuAction>> {
  const items: MenuItem<ChannelMenuAction>[] = [item('show-topics', 'Show its topics')]
  if (state.hasMain) items.push(item('open-main', 'Open Main'), item('open-main-stealth', 'Open Main in stealth'))
  items.push(separator, item('mark-channel-read', 'Mark channel as read'), item('mark-channel-unread', 'Mark channel as unread'))
  if (!isDm(state.channel.kind)) items.push(separator, item('ignore-channel', 'Ignore channel', 'Hide in Juno'))
  return items
}

export type TabKind = 'topic' | 'all-topics' | 'for-you' | 'juno' | 'notifications' | 'preferences'

/** Topic tabs get the topic menu; page tabs have none. */
export function tabMenuItems(tab: { readonly kind: TabKind; readonly topic?: TopicMenuState }): ReadonlyArray<MenuItem<TopicMenuAction>> {
  return tab.kind === 'topic' && tab.topic ? topicMenuItems(tab.topic) : []
}
