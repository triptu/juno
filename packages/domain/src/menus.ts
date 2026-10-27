/**
 * Context menu item lists (spec section 5, inventory section 15). The shell
 * turns these into native menus; the ids come back as actions.
 */
import { channelLabel, isDm, type ChannelInfo, type ChannelNaming } from './channel'
import type { TopicKind } from './ids'
import type { NotifyLevel } from './notifications'

export type TopicMenuAction =
  | 'open-new-tab'
  | 'huddle'
  | 'rename'
  | 'redraw'
  | 'mark-read'
  | 'mark-unread'
  | 'pin'
  | 'unpin'
  | 'resolve'
  | 'reopen'
  | 'copy-link'
  | 'open-in-slack'
  | NotifyAction
  | 'follow-new'
  | ViewMenuAction
  | 'ignore-channel'
  | 'juno-knows'
  | 'how-auto'

export type ChannelMenuAction =
  | 'show-topics'
  | 'open-main'
  | 'huddle'
  | 'mark-channel-read'
  | 'mark-channel-unread'
  | NotifyAction
  | 'how-auto'
  | 'follow-new'
  | ViewMenuAction
  | 'ignore-channel'
  | 'ask-juno'
export type PersonMenuAction = 'ask-juno' | 'juno-knows' | 'how-auto'

/** Add to view (inventory 15.8): add to or remove from a view by id, or a new view with the conversation in it. */
export type ViewMenuAction = `view-add:${string}` | `view-remove:${string}` | 'view-new'

export type MenuItem<A extends string> =
  | { readonly type: 'item'; readonly id: A; readonly label: string; readonly hint?: string; readonly checked?: boolean; readonly sublabel?: string }
  | { readonly type: 'separator' }
  | { readonly type: 'submenu'; readonly label: string; readonly hint?: string; readonly items: ReadonlyArray<MenuItem<A>> }

/**
 * Notify me (spec sections 5 and 14, inventory 15.3). On a thread the
 * choice is also how you follow it: Always and Auto follow it in Slack,
 * Never unfollows it.
 */
export type NotifyChoice = NotifyLevel | 'auto'
export type NotifyAction = 'notify-always' | 'notify-auto' | 'notify-never'

const notifyLabels: Record<NotifyChoice, string> = { always: 'Always', auto: 'Auto', never: 'Never' }

/**
 * A thread's Notify me choice: Never when its level is Never or you do not
 * follow it in Slack, else Always when its level says so, else Auto.
 */
export function threadNotifyChoice(subscribed: boolean, level?: NotifyLevel): NotifyChoice {
  return !subscribed || level === 'never' ? 'never' : level === 'always' ? 'always' : 'auto'
}

/** A channel's, DM's or person's Notify me choice: Auto unless a level is stored. */
export function notifyChoice(level: NotifyLevel | undefined): NotifyChoice {
  return level ?? 'auto'
}

/** The Notify me choice an action picks. */
export function notifyChoiceOf(action: NotifyAction): NotifyChoice {
  return action === 'notify-always' ? 'always' : action === 'notify-auto' ? 'auto' : 'never'
}

export interface TopicMenuState {
  readonly kind: TopicKind
  readonly channel: ChannelNaming
  readonly unread: boolean
  readonly pinned: boolean
  readonly resolved: boolean
  /** The thread's Notify me choice; on Main, its channel's or DM's. */
  readonly notify: NotifyChoice
  /** On Main: whether Juno follows the conversation's new threads. Absent: no item. */
  readonly followNew?: boolean
  /** The views, in pill order, for Add to view on a Main row. Absent: no item. */
  readonly views?: ReadonlyArray<ViewChoice>
  /** Art can be drawn (spec section 5): AI assist on and an OpenRouter key. At the daily AI limit Redraw art still shows and says why it cannot draw. */
  readonly canDraw: boolean
  /** A one-to-one DM's other person, while the Juno Agent is on: What Juno knows about them (SPEC 13.8). */
  readonly knowsAbout?: string
  /** A channel's huddle item (SPEC 20): Start huddle, or Join huddle while one runs there. Absent: no item (a DM, whose header has the control, or while you are in this huddle). */
  readonly huddle?: HuddleMenuItem
}

/** The huddle item of a channel's menus: Start huddle, or Join huddle while one runs there. */
export type HuddleMenuItem = 'start' | 'join'

const huddleItem = (huddle: HuddleMenuItem) => item('huddle' as const, huddle === 'join' ? 'Join huddle' : 'Start huddle')

/** What Juno knows about Maya: their file on What Juno remembers (SPEC 13.8), by first name. */
const knowsAbout = (name: string) => `What Juno knows about ${name.split(' ')[0] ?? name}`

/** A view as Add to view lists it. */
export interface ViewChoice {
  readonly id: string
  readonly name: string
  /** The view holds the conversation: the item has a check and removes it. */
  readonly holds: boolean
}

/** The Add to view submenu (inventory 15.8). */
export function addToViewMenu<A extends string>(views: ReadonlyArray<ViewChoice>): MenuItem<A | ViewMenuAction> {
  const items: MenuItem<ViewMenuAction>[] = views.map((view) => ({
    type: 'item',
    id: view.holds ? `view-remove:${view.id}` : `view-add:${view.id}`,
    label: view.name,
    checked: view.holds,
  }))
  if (items.length > 0) items.push(separator)
  items.push(item('view-new', 'New view…'))
  return { type: 'submenu', label: 'Add to view', items }
}

/** What an Add to view item asks for. */
export function viewMenuChoice(action: ViewMenuAction): { readonly kind: 'add' | 'remove'; readonly view: string } | { readonly kind: 'new' } {
  if (action === 'view-new') return { kind: 'new' }
  const colon = action.indexOf(':')
  return { kind: action.slice(0, colon) === 'view-add' ? 'add' : 'remove', view: action.slice(colon + 1) }
}

/** Whether a menu id is an Add to view item. */
export function isViewMenuAction(id: string): id is ViewMenuAction {
  return id === 'view-new' || id.startsWith('view-add:') || id.startsWith('view-remove:')
}

export type ViewPillAction = 'view-edit' | 'view-left' | 'view-right' | 'view-delete'

/** The menu on a view's pill (inventory 15.7). The owner disables Move left and Move right at the ends. */
export function viewPillMenuItems(): ReadonlyArray<MenuItem<ViewPillAction>> {
  return [item('view-edit', 'Edit view…'), item('view-left', 'Move left'), item('view-right', 'Move right'), separator, item('view-delete', 'Delete view')]
}

const separator = { type: 'separator' } as const

function item<A extends string>(id: A, label: string, hint?: string): MenuItem<A> {
  return hint === undefined ? { type: 'item', id, label } : { type: 'item', id, label, hint }
}

/** The three levels, then How Auto decides…, which opens Settings › Notifications at its box. */
function notifyMenu(current: NotifyChoice, label = 'Notify me'): MenuItem<NotifyAction | 'how-auto'> {
  const choice = (level: NotifyChoice): MenuItem<NotifyAction> => ({ type: 'item', id: `notify-${level}`, label: notifyLabels[level], checked: level === current })
  return { type: 'submenu', label, hint: notifyLabels[current], items: [choice('always'), choice('auto'), choice('never'), separator, item('how-auto', 'How Auto decides…')] }
}

/** Follow new threads (spec section 5): checked while Juno follows every new thread in the conversation. */
function followNewItem(on: boolean): MenuItem<'follow-new'> {
  return { type: 'item', id: 'follow-new', label: 'Follow new threads', checked: on }
}

/** How a toast names a choice: "#design-review: Never". */
export function notifyChoiceLabel(choice: NotifyChoice): string {
  return notifyLabels[choice]
}

/** The menu for a topic row and the page header's title (inventory 15.1). */
export function topicMenuItems(state: TopicMenuState): ReadonlyArray<MenuItem<TopicMenuAction>> {
  const isMain = state.kind === 'main'
  const items: MenuItem<TopicMenuAction>[] = [item('open-new-tab', 'Open in new tab', '⌘ click')]
  if (state.huddle !== undefined) items.push(huddleItem(state.huddle))
  items.push(separator)
  if (!isMain) items.push(item('rename', 'Rename'))
  // A new drawing of the topic's art, only when one can be made. A DM's Main shows the person's photo, so there is nothing to redraw.
  if (state.canDraw && !(isMain && isDm(state.channel.kind))) items.push(item('redraw', 'Redraw art'))
  items.push(state.unread ? item('mark-read', 'Mark as read') : item('mark-unread', 'Mark as unread'))
  items.push(state.pinned ? item('unpin', 'Unpin') : item('pin', 'Pin'))
  items.push(state.resolved ? item('reopen', 'Reopen') : item('resolve', 'Resolve'))
  items.push(separator, item('copy-link', 'Copy Slack link'), item('open-in-slack', 'Open in Slack'))
  items.push(notifyMenu(state.notify))
  if (isMain && state.followNew !== undefined) items.push(followNewItem(state.followNew))
  if (isMain && state.views !== undefined) items.push(addToViewMenu<TopicMenuAction>(state.views))
  if (!isDm(state.channel.kind)) items.push(item('ignore-channel', `Ignore ${channelLabel(state.channel)}`))
  if (state.knowsAbout !== undefined) items.push(separator, item('juno-knows', knowsAbout(state.knowsAbout)))
  return items
}

export interface ChannelMenuState {
  readonly channel: ChannelInfo
  readonly hasMain: boolean
  /** The channel's Notify me choice; the submenu shows when it is given. */
  readonly notify?: NotifyChoice
  /** Whether Juno follows the conversation's new threads; the item shows when it is given. */
  readonly followNew?: boolean
  /** The Juno Agent is on: Ask Juno shows (SPEC 7). */
  readonly askJuno?: boolean
  /** The views, in pill order, for Add to view. Absent: no item. */
  readonly views?: ReadonlyArray<ViewChoice>
  /** Start huddle or Join huddle, as in the topic menu. Absent: no item. */
  readonly huddle?: HuddleMenuItem
}

/** The channel menu (inventory 15.2): a channel row in Browse, the header's context pill, a #channel chip. */
export function channelMenuItems(state: ChannelMenuState): ReadonlyArray<MenuItem<ChannelMenuAction>> {
  const items: MenuItem<ChannelMenuAction>[] = [item('show-topics', 'Show its topics')]
  if (state.hasMain) items.push(item('open-main', 'Open Main'))
  if (state.huddle !== undefined) items.push(huddleItem(state.huddle))
  items.push(separator, item('mark-channel-read', 'Mark channel as read'), item('mark-channel-unread', 'Mark channel as unread'))
  if (state.notify !== undefined || state.followNew !== undefined || state.views !== undefined || !isDm(state.channel.kind)) items.push(separator)
  if (state.notify !== undefined) items.push(notifyMenu(state.notify))
  if (state.followNew !== undefined) items.push(followNewItem(state.followNew))
  if (state.views !== undefined) items.push(addToViewMenu<ChannelMenuAction>(state.views))
  if (!isDm(state.channel.kind)) items.push(item('ignore-channel', 'Ignore channel', 'Hide in Juno'))
  if (state.askJuno === true) items.push(separator, item('ask-juno', 'Ask Juno'))
  return items
}

export interface PersonMenuState {
  readonly name: string
  readonly notify: NotifyChoice
  /** The Juno Agent is on: Ask Juno shows (SPEC 7). */
  readonly askJuno?: boolean
}

/** The person menu (inventory 15.6): Notify me about them, then Ask Juno and What Juno knows about them while the agent runs. */
export function personMenuItems(person: PersonMenuState): ReadonlyArray<MenuItem<NotifyAction | PersonMenuAction>> {
  const first = person.name.split(' ')[0] ?? person.name
  const notify: MenuItem<NotifyAction | PersonMenuAction> = notifyMenu(person.notify, `Notify me about ${first}`)
  return person.askJuno === true ? [notify, separator, item('ask-juno', 'Ask Juno'), item('juno-knows', knowsAbout(person.name))] : [notify]
}
