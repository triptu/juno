/**
 * Context menu item lists (spec section 5, inventory section 15). The shell
 * turns these into native menus; the ids come back as actions.
 */
import { channelLabel, isDm, type ChannelInfo, type ChannelNaming } from './channel'
import type { TopicKind } from './ids'
import type { NotifyLevel } from './notifications'

export type TopicMenuAction =
  | 'open-new-tab'
  | 'rename'
  | 'mark-read'
  | 'mark-unread'
  | 'pin'
  | 'unpin'
  | 'resolve'
  | 'reopen'
  | 'copy-link'
  | 'open-in-slack'
  | NotifyAction
  | 'ignore-channel'

export type ChannelMenuAction = 'show-topics' | 'open-main' | 'mark-channel-read' | 'mark-channel-unread' | 'ignore-channel'

export type MenuItem<A extends string> =
  | { readonly type: 'item'; readonly id: A; readonly label: string; readonly hint?: string; readonly checked?: boolean }
  | { readonly type: 'separator' }
  | { readonly type: 'submenu'; readonly label: string; readonly hint?: string; readonly items: ReadonlyArray<MenuItem<A>> }

/**
 * Notify me (spec sections 5 and 14, inventory 15.3). On a thread the
 * choice is also how you follow it: Every message and When it matters
 * follow it in Slack, Never unfollows it.
 */
export type NotifyChoice = NotifyLevel | 'matters'
export type NotifyAction = 'notify-every' | 'notify-matters' | 'notify-never'

const notifyLabels: Record<NotifyChoice, string> = { every: 'Every message', matters: 'When it matters', never: 'Never' }

/**
 * A thread's Notify me choice: Never when you do not follow it in Slack,
 * else Every message when its level says so, else When it matters.
 */
export function threadNotifyChoice(subscribed: boolean, level?: NotifyLevel): NotifyChoice {
  return !subscribed ? 'never' : level === 'every' ? 'every' : 'matters'
}

/** A channel's, DM's or person's Notify me choice: When it matters unless a level is stored. */
export function notifyChoice(level: NotifyLevel | undefined): NotifyChoice {
  return level ?? 'matters'
}

/** The Notify me choice an action picks. */
export function notifyChoiceOf(action: NotifyAction): NotifyChoice {
  return action === 'notify-every' ? 'every' : action === 'notify-matters' ? 'matters' : 'never'
}

/** Whether a thread with this choice is followed in Slack. */
export function followsThread(level: NotifyChoice): boolean {
  return level !== 'never'
}

export interface TopicMenuState {
  readonly kind: TopicKind
  readonly channel: ChannelNaming
  readonly unread: boolean
  readonly pinned: boolean
  readonly resolved: boolean
  /** The thread's Notify me choice; on Main, its channel's or DM's. */
  readonly notify: NotifyChoice
}

const separator = { type: 'separator' } as const

function item<A extends string>(id: A, label: string, hint?: string): MenuItem<A> {
  return hint === undefined ? { type: 'item', id, label } : { type: 'item', id, label, hint }
}

function notifyMenu(current: NotifyChoice, label = 'Notify me'): MenuItem<NotifyAction> {
  const choice = (level: NotifyChoice): MenuItem<NotifyAction> => ({ type: 'item', id: `notify-${level}`, label: notifyLabels[level], checked: level === current })
  return { type: 'submenu', label, hint: notifyLabels[current], items: [choice('every'), choice('matters'), choice('never')] }
}

/** How a toast names a choice: "#design-review: Never". */
export function notifyChoiceLabel(choice: NotifyChoice): string {
  return notifyLabels[choice]
}

/** The menu for a topic row and the page header's title (inventory 15.1). */
export function topicMenuItems(state: TopicMenuState): ReadonlyArray<MenuItem<TopicMenuAction>> {
  const isMain = state.kind === 'main'
  const items: MenuItem<TopicMenuAction>[] = [item('open-new-tab', 'Open in new tab', '⌘ click'), separator]
  if (!isMain) items.push(item('rename', 'Rename'))
  items.push(state.unread ? item('mark-read', 'Mark as read') : item('mark-unread', 'Mark as unread'))
  items.push(state.pinned ? item('unpin', 'Unpin') : item('pin', 'Pin'))
  items.push(state.resolved ? item('reopen', 'Reopen') : item('resolve', 'Resolve'))
  items.push(separator, item('copy-link', 'Copy Slack link'), item('open-in-slack', 'Open in Slack'))
  items.push(notifyMenu(state.notify))
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
  if (state.hasMain) items.push(item('open-main', 'Open Main'))
  items.push(separator, item('mark-channel-read', 'Mark channel as read'), item('mark-channel-unread', 'Mark channel as unread'))
  if (!isDm(state.channel.kind)) items.push(separator, item('ignore-channel', 'Ignore channel', 'Hide in Juno'))
  return items
}

/** The person menu (inventory 15.6): Notify me about them. Ask Juno comes with the Juno panel. */
export function personMenuItems(person: { readonly name: string; readonly notify: NotifyChoice }): ReadonlyArray<MenuItem<NotifyAction>> {
  const first = person.name.split(' ')[0] ?? person.name
  return [notifyMenu(person.notify, `Notify me about ${first}`)]
}

/** The message menu's why item (inventory 15.4), by what happened to the message. */
export function whyLabel(notified: boolean): string {
  return notified ? 'Why did this notify?' : 'Why no notification?'
}

export type TabKind = 'topic' | 'all-topics' | 'juno' | 'notifications' | 'preferences'

/** Topic tabs get the topic menu; page tabs have none. */
export function tabMenuItems(tab: { readonly kind: TabKind; readonly topic?: TopicMenuState }): ReadonlyArray<MenuItem<TopicMenuAction>> {
  return tab.kind === 'topic' && tab.topic ? topicMenuItems(tab.topic) : []
}
