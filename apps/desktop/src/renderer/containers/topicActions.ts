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
  channelsIgnore,
  followsThread,
  notifyChoiceOf,
  readsMarkRead,
  readsMarkUnread,
  threadNotifyChoice,
  topicMenuItems,
  topicsPin,
  topicsRename,
  topicsReopen,
  topicsResolve,
  topicsSubscribe,
  topicsUnpin,
  topicsUnsubscribe,
  type ContextMenuAt,
  type ContextMenuItem,
  type ContextMenuLeaf,
  type MenuCommand,
  type MenuItem,
  type MessageView,
  type NotifyChoice,
  type TopicDetail,
  type TopicMenuAction,
} from '@juno/contract'
import {
  copyText,
  editUndo,
  messageLink,
  openInSlack,
  popupContextMenu,
  registry,
  renamingAtom,
  runAction,
  sidebarRowAtom,
  signedInAtom,
  slackLink,
  threadRootTs,
  topicAtom,
  undoLast,
  type ToastContent,
} from '@juno/state'
import { openTopic } from './navigation'

/** What the actions read from a sidebar row or the header's detail. Copy Slack link and Open in Slack need the detail's root. */
export type ActionTopic = Pick<TopicDetail, 'id' | 'kind' | 'title' | 'channel' | 'unreadCount' | 'pinned' | 'resolved' | 'subscribed'> & {
  readonly rootTs?: string | undefined
}

/** The header's detail when it is loaded, else the sidebar row with its thread's root from the id. */
function topicOf(id: string): ActionTopic | undefined {
  const header = registry.get(topicAtom(id))
  if (header._tag === 'Success' && header.value !== null) return header.value
  const row = registry.get(sidebarRowAtom(id))
  return row === undefined ? undefined : { ...row, rootTs: threadRootTs(id) }
}

/** How a toast names a topic: its title, or the channel label for Main ("#eng"). */
function labelOf(topic: ActionTopic): string {
  return topic.kind === 'main' ? topic.channel.label : topic.title
}

const said = (verb: string, topic: ActionTopic): ToastContent => ({ text: `${verb} · ${labelOf(topic)}` })

/** Resolve, from a row's check, the header and the menus: hides the row, marks it read, toast with Undo. */
export function resolveTopic(id: string): void {
  const topic = topicOf(id)
  if (topic !== undefined) void runAction(registry, topicsResolve, { id }, { ...said('Resolved', topic), check: true })
}

function reopenTopic(topic: ActionTopic): void {
  void runAction(registry, topicsReopen, { id: topic.id }, said('Reopened', topic))
}

/** The header's Resolve, or Reopen on a resolved topic. */
export function toggleResolved(id: string): void {
  const topic = topicOf(id)
  if (topic === undefined) return
  if (topic.resolved) reopenTopic(topic)
  else resolveTopic(id)
}

/** Rename saved: the engine clears the manual title for an empty one or the AI title. */
export function renameTopic(id: string, title: string): void {
  registry.set(renamingAtom, undefined)
  const topic = topicOf(id)
  if (topic === undefined || title.trim() === topic.title) return
  const text = title.trim() === '' ? 'Title cleared' : `Renamed · ${title.trim()}`
  void runAction(registry, topicsRename, { id, title }, { text })
}

export function cancelRename(): void {
  registry.set(renamingAtom, undefined)
}

const notifyToast: Record<NotifyChoice, string> = { every: 'Every message', matters: 'When it matters', never: 'Never' }

/**
 * The topic menu (inventory 15.1), on a sidebar row and the header's title,
 * at the pointer or at `at`. `from` says which title Rename edits. Notify me
 * on a thread is how it is followed: Every message and When it matters
 * follow it in Slack, Never unfollows it (SPEC 5).
 */
export async function showTopicMenu(topic: ActionTopic, from: 'row' | 'header', at?: ContextMenuAt): Promise<void> {
  const state = { kind: topic.kind, channel: topic.channel, unread: topic.unreadCount > 0, pinned: topic.pinned, resolved: topic.resolved, notify: threadNotifyChoice(topic.subscribed) }
  const linkable = topic.kind === 'main' || topic.rootTs !== undefined
  const chosen = (await popupContextMenu(topicMenuItems(state).map((item) => nativeItem(item, linkable)), at)) as TopicMenuAction | undefined
  const { id } = topic
  switch (chosen) {
    case 'open-new-tab':
      return openTopic(id, { newTab: true })
    case 'rename':
      return registry.set(renamingAtom, { id, where: from })
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
    case 'notify-every':
    case 'notify-matters':
    case 'notify-never': {
      const choice = notifyChoiceOf(chosen)
      const follow = followsThread(choice)
      if (follow !== topic.subscribed) void runAction(registry, follow ? topicsSubscribe : topicsUnsubscribe, { id }, { text: `${labelOf(topic)}: ${notifyToast[choice]}` })
      return
    }
    case 'ignore-channel':
      return void runAction(registry, channelsIgnore, { channel: topic.channel.id }, { text: `Ignoring ${topic.channel.label}` })
  }
}

function nativeItem(item: MenuItem<TopicMenuAction>, linkable: boolean): ContextMenuItem {
  switch (item.type) {
    case 'separator':
      return { separator: true }
    case 'submenu':
      return { label: item.label, submenu: item.items.map((sub) => nativeItem(sub, linkable) as ContextMenuLeaf) }
    case 'item': {
      const enabled = linkable || (item.id !== 'copy-link' && item.id !== 'open-in-slack')
      return { id: item.id, label: item.label, ...(enabled ? {} : { enabled: false }), ...(item.checked === undefined ? {} : { checked: item.checked }) }
    }
  }
}

/** A sidebar row's menu: the row, with the detail when it is loaded, for the link items. */
export function showRowMenu(id: string): void {
  const topic = topicOf(id)
  if (topic !== undefined) void showTopicMenu(topic, 'row')
}

function openTopicInSlack(topic: ActionTopic): void {
  const session = registry.get(signedInAtom)
  if (session !== undefined) openInSlack({ teamId: session.teamId, channelId: topic.channel.id })
}

/** What the message menu leaves to the topic: the edit field, the delete confirm, opening the thread. */
export type MessageMenuChoice = 'edit' | 'delete' | 'reply'

/**
 * The message menu (SPEC 7 "More", inventory 15.4), from the toolbar's More
 * and from a right-click: Edit and Delete on your own messages, Reply in
 * thread in Main, then Copy Slack link and Open in Slack. A reply's link
 * carries its thread. A message Slack does not have yet has no link.
 */
export async function showMessageMenu(topic: ActionTopic, message: Pick<MessageView, 'ts' | 'pending'>, own: boolean, at?: ContextMenuAt): Promise<MessageMenuChoice | undefined> {
  const linkable = message.pending === undefined
  const items: Array<ContextMenuItem> = [
    ...(own ? [{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete' }, { separator: true } as const] : []),
    ...(topic.kind === 'main' && linkable ? [{ id: 'reply', label: 'Reply in thread' }, { separator: true } as const] : []),
    { id: 'copy-link', label: 'Copy Slack link', ...(linkable ? {} : { enabled: false }) },
    { id: 'open-in-slack', label: 'Open in Slack' },
  ]
  const chosen = await popupContextMenu(items, at)
  if (chosen === 'edit' || chosen === 'delete' || chosen === 'reply') return chosen
  if (chosen === 'open-in-slack') {
    openTopicInSlack(topic)
    return undefined
  }
  const session = registry.get(signedInAtom)
  if (chosen === 'copy-link' && session !== undefined) copyText(messageLink(session.workspaceUrl, topic.channel.id, message.ts, topic.kind === 'thread' ? topic.rootTs : undefined))
  return undefined
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
  else void undoLast(registry)
}

/** The toast's Undo. */
export function undoFromToast(): void {
  void undoLast(registry)
}
