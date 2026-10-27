/**
 * The topic actions (SPEC 5 "Row actions", inventory 15.1 and 16), for
 * every place that offers them: a sidebar row's check and menu, the
 * header's Resolve or Reopen and its title menu, and the message menu.
 *
 * Each action runs its command through `runAction`, which keeps the undo
 * the engine returned and shows the toast. ⌘Z (Edit › Undo) undoes typing
 * in a text field that has text, and otherwise Juno's last action.
 */
import {
  isViewMenuAction,
  notifyChoiceOf,
  readsMarkRead,
  readsMarkUnread,
  topicsPin,
  topicsRename,
  topicsReopen,
  topicsResolve,
  topicsUnpin,
  type ContextMenuAt,
  type MenuCommand,
  type NotifyTargetView,
  type TopicMenuAction,
} from '@juno/contract'
import {
  copyText,
  currentNotificationSettings,
  editUndo,
  flushSidebar,
  ignoreChannel,
  openInSlack,
  registry,
  releaseSidebarTopic,
  renamingAtom,
  runAction,
  signedInAtom,
  slackLink,
  undoLast,
  type RenameTarget,
  type ToastContent,
} from '@juno/state'
import { openTopic, openTopicFromList } from './navigation'
import { runViewMenuAction } from './viewActions'
import { openNotificationsAt } from './notificationsAnchor'
import { followsNew, setFollowNew, setNotifyLevel } from './notifyActions'
import { showWhatJunoKnows } from './juno/actions'
import { joinHuddleFromMenu } from './huddle/menuItem'
import { headerOf, rowOf, topicOf, type ActionTopic } from './topicSource'

/** How a toast names a topic: its title, or the channel label for Main ("#eng"). */
export function labelOf(topic: ActionTopic): string {
  return topic.kind === 'main' ? topic.channel.label : topic.title
}

const said = (verb: string, topic: ActionTopic): ToastContent => ({ text: `${verb} · ${labelOf(topic)}` })

/** Resolve, from a row's check, the header and the menus: hides the row, marks it read, toast with Undo. */
export function resolveTopic(id: string): void {
  const topic = topicOf(id)
  // Your own action shows at once, even while the sidebar holds its order (SPEC 5).
  releaseSidebarTopic(registry, id)
  if (topic !== undefined) void runAction(registry, topicsResolve, { id }, { ...said('Resolved', topic), check: true })
}

function reopenTopic(topic: ActionTopic): void {
  releaseSidebarTopic(registry, topic.id)
  void runAction(registry, topicsReopen, { id: topic.id }, said('Reopened', topic))
}

/** The header's Resolve, or Reopen on a resolved topic. */
export function toggleResolved(id: string): void {
  const topic = topicOf(id)
  if (topic === undefined) return
  if (topic.resolved) reopenTopic(topic)
  else resolveTopic(id)
}

/**
 * Mark unread on a message (the message menu and U): that message and everything after it are unread, with
 * the topic held unread while it stays open, as the topic's Mark as unread (SPEC 7).
 */
export function markUnreadFrom(id: string, ts: string): void {
  const topic = topicOf(id)
  releaseSidebarTopic(registry, id)
  void runAction(registry, readsMarkUnread, { id, from: ts }, topic === undefined ? { text: 'Marked as unread' } : said('Marked as unread', topic))
}

/** Rename saved: the engine clears the manual title for an empty one or the AI title. */
export function renameTopic(id: string, title: string): void {
  registry.set(renamingAtom, undefined)
  const topic = topicOf(id)
  if (topic === undefined || title.trim() === topic.title) return
  const text = title.trim() === '' ? 'Title cleared' : `Renamed · ${title.trim()}`
  releaseSidebarTopic(registry, id)
  void runAction(registry, topicsRename, { id, title }, { text })
}

export function cancelRename(): void {
  registry.set(renamingAtom, undefined)
}

/** What Notify me applies to: the thread itself, or on Main the channel or DM. */
export function notifyTarget(topic: ActionTopic): { readonly target: NotifyTargetView; readonly label: string } {
  return topic.kind === 'main' ? { target: { kind: 'channel', id: topic.channel.id }, label: topic.channel.label } : { target: { kind: 'thread', id: topic.id }, label: topic.title }
}

/** Warms the native topic menu after the first sidebar paint. */
export const loadTopicMenu = () => import('./topicMenu')

export async function showTopicMenu(topic: ActionTopic, from: RenameTarget['where'], at?: ContextMenuAt): Promise<void> {
  return (await loadTopicMenu()).showTopicMenu(topic, from, at)
}

/** The other person of a one-to-one DM, for What Juno knows about them. */
const dmPartner = (topic: ActionTopic) => (topic.channel.kind === 'im' ? topic.channel.partner : undefined)

/** Whether Copy Slack link and Open in Slack have a link: a Main, or a thread whose root is known. */
export const isLinkable = (topic: ActionTopic): boolean => topic.kind === 'main' || topic.rootTs !== undefined

/** One topic action, from the topic menu or the ⌘K palette. `from` says which title Rename edits. */
export function runTopicAction(topic: ActionTopic, chosen: TopicMenuAction, from: RenameTarget['where']): void {
  const { id } = topic
  // Pin, read state, Notify me, views and the rest move this row at once, even while the sidebar holds its order (SPEC 5).
  releaseSidebarTopic(registry, id)
  if (isViewMenuAction(chosen)) return runViewMenuAction(chosen, topic.channel)
  const notify = notifyTarget(topic)
  switch (chosen) {
    case 'open-new-tab':
      return from === 'row' ? openTopicFromList(id, { newTab: true }) : openTopic(id, { newTab: true })
    case 'huddle':
      return joinHuddleFromMenu(topic.channel.id)
    case 'rename':
      return registry.set(renamingAtom, { id, where: from })
    case 'redraw':
      return void loadTopicMenu().then((menu) => menu.redrawArt(topic))
    case 'mark-read':
      return void runAction(registry, readsMarkRead, { id }, said('Marked as read', topic))
    case 'mark-unread':
      return void runAction(registry, readsMarkUnread, { id }, said('Marked as unread', topic))
    case 'pin':
      return void runAction(registry, topicsPin, { id }, said('Pinned', topic))
    case 'unpin':
      return void runAction(registry, topicsUnpin, { id }, said('Unpinned', topic))
    case 'resolve':
      return resolveTopic(id)
    case 'reopen':
      return reopenTopic(topic)
    case 'copy-link': {
      const session = registry.get(signedInAtom)
      if (session !== undefined) copyText(slackLink(session.workspaceUrl, topic))
      return
    }
    case 'open-in-slack':
      return openTopicInSlack(topic)
    case 'notify-always':
    case 'notify-auto':
    case 'notify-never':
      return setNotifyLevel(notify.target, notifyChoiceOf(chosen), notify.label)
    case 'how-auto':
      return openNotificationsAt('how-auto')
    case 'follow-new':
      return setFollowNew(topic.channel, !followsNew(currentNotificationSettings(registry), topic.channel.id))
    case 'ignore-channel':
      flushSidebar(registry)
      return void ignoreChannel(registry, topic.channel)
    case 'edit-channel':
      // Loaded on use: the channel sheet's actions are not part of the first screen.
      return void import('./channelActions').then(({ editChannel }) => editChannel(topic.channel))
    case 'juno-knows': {
      const partner = dmPartner(topic)
      return partner === undefined ? undefined : void showWhatJunoKnows(partner)
    }
  }
}

/**
 * A row's menu reads the row, which is what the user sees. The header's detail is a separate live query that can
 * trail the row by a moment after an action or its Undo, so it is only the fallback.
 */
const topicOfRow = (id: string): ActionTopic | undefined => rowOf(id) ?? headerOf(id)

/** A sidebar row's menu. */
export function showRowMenu(id: string): void {
  const topic = topicOfRow(id)
  if (topic !== undefined) void showTopicMenu(topic, 'row')
}

/** An All topics row's menu: the same menu; Rename edits the table row. */
export function showTableRowMenu(id: string): void {
  const topic = topicOfRow(id)
  if (topic !== undefined) void showTopicMenu(topic, 'table')
}

/** Open in Slack: the topic's channel in the Slack app. */
export function openTopicInSlack(topic: ActionTopic): void {
  const session = registry.get(signedInAtom)
  if (session !== undefined) openInSlack({ teamId: session.teamId, channelId: topic.channel.id })
}

/**
 * "Also send to #eng" on your own thread reply, as Slack's "Send reply to
 * this channel"; "Also send to Main" in a DM or group DM, whose Main is the
 * conversation. Slack has threads in all four kinds.
 */
export function broadcastLabel(channel: Pick<ActionTopic['channel'], 'kind' | 'name'>): string {
  return channel.kind === 'public' || channel.kind === 'private' ? `Also send to #${channel.name}` : 'Also send to Main'
}

/** Whether focus is in a text field that has text, where ⌘Z undoes typing. */
function editingText(): boolean {
  const focused = document.activeElement
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return focused.value !== ''
  return focused instanceof HTMLElement && focused.isContentEditable && (focused.textContent ?? '') !== ''
}

/** Edit › Undo (⌘Z). */
export function runUndoCommand(command: MenuCommand): void {
  if (command !== 'edit.undo') return
  if (editingText()) editUndo()
  else undo()
}

/** The toast's Undo. */
export function undoFromToast(): void {
  undo()
}

/** Undo is your own action: the sidebar shows its result at once, even while it holds its order. */
function undo(): void {
  flushSidebar(registry)
  void undoLast(registry)
}
