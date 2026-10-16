import { junoNavAtom, watchReply } from '@juno/state/agent'
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
  isViewMenuAction,
  notifyChoiceOf,
  readsMarkRead,
  readsMarkUnread,
  topicMenuItems,
  topicsPin,
  topicsRename,
  topicsReopen,
  topicsResolve,
  topicsUnpin,
  whyLabel,
  type ContextMenuAt,
  type ContextMenuItem,
  type MenuCommand,
  type MessageView,
  type NotifyTargetView,
  type TopicDetail,
  type TopicMenuAction,
} from '@juno/contract'
import {
  allTopicsRowAtom,
  copyText,
  currentNotificationSettings,
  editUndo,
  loadNotificationSettings,
  loadWhy,
  messageLink,
  openInSlack,
  popupContextMenu,
  redrawTopic,
  registry,
  renamingAtom,
  runAction,
  showToast,
  sidebarRowAtom,
  signedInAtom,
  slackLink,
  threadRootTs,
  topicAtom,
  undoLast,
  type RedrawProblem,
  type RenameTarget,
  type ToastContent,
} from '@juno/state'
import { openTopic } from './navigation'
import { runViewMenuAction, viewChoices } from './viewActions'
import { choiceFor, nativeMenu, setNotifyLevel, showPersonMenu, showWhy } from './notifyActions'

/** What the actions read from a sidebar row or the header's detail. Copy Slack link and Open in Slack need the detail's root. */
export type ActionTopic = Pick<TopicDetail, 'id' | 'kind' | 'title' | 'channel' | 'unreadCount' | 'pinned' | 'resolved' | 'subscribed'> & {
  readonly rootTs?: string | undefined
}

/** The header's detail when it is loaded, else the sidebar or All topics row, with its thread's root from the id. */
export function topicOf(id: string): ActionTopic | undefined {
  const header = registry.get(topicAtom(id))
  if (header._tag === 'Success' && header.value !== null) return header.value
  const row = registry.get(sidebarRowAtom(id)) ?? registry.get(allTopicsRowAtom(id))
  return row === undefined ? undefined : { ...row, rootTs: threadRootTs(id) }
}

/** How a toast names a topic: its title, or the channel label for Main ("#eng"). */
export function labelOf(topic: ActionTopic): string {
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

/** Why Redraw made nothing, said plainly. */
const REDRAW_PROBLEMS: Record<RedrawProblem, string> = {
  off: 'AI assist is off',
  budget: 'Today’s AI spend cap is reached',
  'no-key': 'Add an OpenRouter key in Settings › Juno',
  'no-agent': 'Juno’s agent did not answer the spend check',
  timeout: 'The model took too long',
  provider: 'The model service returned an error',
  invalid: 'The model’s drawing could not be used',
  other: 'Something went wrong',
}

/** Redraw: a new drawing from the model, which takes a few seconds; the undo puts the old one back. */
async function redrawArt(topic: ActionTopic): Promise<void> {
  const problem = await redrawTopic(registry, topic.id, said('Redrawn', topic))
  if (problem !== undefined) showToast(registry, { text: `Could not redraw · ${REDRAW_PROBLEMS[problem]}` })
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

/** What Notify me applies to: the thread itself, or on Main the channel or DM. */
function notifyTarget(topic: ActionTopic): { readonly target: NotifyTargetView; readonly label: string } {
  return topic.kind === 'main' ? { target: { kind: 'channel', id: topic.channel.id }, label: topic.channel.label } : { target: { kind: 'thread', id: topic.id }, label: topic.title }
}

/**
 * The topic menu (inventory 15.1), on a sidebar row and the header's title,
 * at the pointer or at `at`. `from` says which title Rename edits. Notify me
 * on a thread is how it is followed: Every message and When it matters
 * follow it in Slack, Never unfollows it (SPEC 5). On Main it is the
 * channel's or DM's choice.
 */
export async function showTopicMenu(topic: ActionTopic, from: RenameTarget['where'], at?: ContextMenuAt): Promise<void> {
  const settings = currentNotificationSettings(registry) ?? (await loadNotificationSettings(registry))
  const notify = notifyTarget(topic)
  const state = {
    kind: topic.kind,
    channel: topic.channel,
    unread: topic.unreadCount > 0,
    pinned: topic.pinned,
    resolved: topic.resolved,
    notify: choiceFor(settings, notify.target, topic.subscribed),
    aiAssist: settings?.aiAssist === true,
    // Add to view (inventory 15.8) is on Main: the row's channel or DM.
    ...(topic.kind === 'main' ? { views: viewChoices(topic.channel.id) } : {}),
  }
  const chosen = (await popupContextMenu(nativeMenu(topicMenuItems(state), (id) => isLinkable(topic) || (id !== 'copy-link' && id !== 'open-in-slack')), at)) as TopicMenuAction | undefined
  if (chosen !== undefined) runTopicAction(topic, chosen, from)
}

/** Whether Copy Slack link and Open in Slack have a link: a Main, or a thread whose root is known. */
export const isLinkable = (topic: ActionTopic): boolean => topic.kind === 'main' || topic.rootTs !== undefined

/** One topic action, from the topic menu or the ⌘K palette. `from` says which title Rename edits. */
export function runTopicAction(topic: ActionTopic, chosen: TopicMenuAction, from: RenameTarget['where']): void {
  const { id } = topic
  if (isViewMenuAction(chosen)) return runViewMenuAction(chosen, topic.channel)
  const notify = notifyTarget(topic)
  switch (chosen) {
    case 'open-new-tab':
      return openTopic(id, { newTab: true })
    case 'rename':
      return registry.set(renamingAtom, { id, where: from })
    case 'redraw':
      return void redrawArt(topic)
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
    case 'notify-never':
      return setNotifyLevel(notify.target, notifyChoiceOf(chosen), notify.label)
    case 'ignore-channel':
      return void runAction(registry, channelsIgnore, { channel: topic.channel.id }, { text: `Ignoring ${topic.channel.label}` })
  }
}

/** A sidebar row's menu: the row, with the detail when it is loaded, for the link items. */
export function showRowMenu(id: string): void {
  const topic = topicOf(id)
  if (topic !== undefined) void showTopicMenu(topic, 'row')
}

/** An All topics row's menu: the same menu; Rename edits the table row. */
export function showTableRowMenu(id: string): void {
  const topic = topicOf(id)
  if (topic !== undefined) void showTopicMenu(topic, 'table')
}

function openTopicInSlack(topic: ActionTopic): void {
  const session = registry.get(signedInAtom)
  if (session !== undefined) openInSlack({ teamId: session.teamId, channelId: topic.channel.id })
}

/** What the message menu leaves to the topic: the edit field, the delete confirm, opening the thread. */
export type MessageMenuChoice = 'edit' | 'delete' | 'reply'

/**
 * The message menu (SPEC 7 "More", inventory 15.4 and 15.6), from the
 * toolbar's More and from a right-click: Edit and Delete on your own
 * messages, Start thread or Open thread in Main, Copy Slack link and Open in Slack,
 * and, on someone else's message, why it did or did not notify. A reply's
 * link carries its thread; a message Slack does not have yet has none. On
 * the sender's name or avatar it is the person menu.
 */
export async function showMessageMenu(
  topic: ActionTopic,
  message: Pick<MessageView, 'ts' | 'pending' | 'thread'>,
  editable: boolean,
  at: ContextMenuAt,
  sender: { readonly id: string; readonly name: string } | undefined,
  onSender: boolean,
): Promise<MessageMenuChoice | undefined> {
  const session = registry.get(signedInAtom)
  const own = sender !== undefined && sender.id === session?.userId
  if (onSender && sender !== undefined && !own) {
    await showPersonMenu(sender, at)
    return undefined
  }
  const { ts } = message
  const linkable = message.pending === undefined
  const why = own || !linkable ? undefined : await loadWhy(registry, topic.id, ts)
  const items: ContextMenuItem[] = [
    ...(editable ? [{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete' }, { separator: true } as const] : []),
    ...(topic.kind === 'main' && linkable ? [{ id: 'reply', label: message.thread === undefined ? 'Start thread' : 'Open thread' }, { separator: true } as const] : []),
    ...(own && linkable ? [{ id: 'watch-reply', label: 'Tell me if nobody replies', enabled: registry.get(junoNavAtom).mayAuthorize === true }] : []),
    { id: 'copy-link', label: 'Copy Slack link', ...(linkable ? {} : { enabled: false }) },
    { id: 'open-in-slack', label: 'Open in Slack' },
    ...(why === undefined ? [] : [{ separator: true } as const, { id: 'why', label: whyLabel(why.notified) }]),
  ]
  const chosen = await popupContextMenu(items, at)
  if (chosen === 'edit' || chosen === 'delete' || chosen === 'reply') return chosen
  if (chosen === 'watch-reply') await watchReply(registry, { channelId: topic.channel.id, ts, ...(topic.kind === 'thread' && topic.rootTs ? { threadTs: topic.rootTs } : {}) })
  else if (chosen === 'open-in-slack') openTopicInSlack(topic)
  else if (chosen === 'why' && why !== undefined) showWhy(topic.id, ts, why, at)
  else if (chosen === 'copy-link' && session !== undefined) copyText(messageLink(session.workspaceUrl, topic.channel.id, ts, topic.kind === 'thread' ? topic.rootTs : undefined))
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
