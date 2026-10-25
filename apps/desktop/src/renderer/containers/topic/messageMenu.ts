/**
 * A topic message's menu (SPEC 7, "Message menu"; inventory 15.4): its rows,
 * what each does, and the emoji grid's reactions. Loaded with the menu, when
 * idle (`../messageMenu.tsx`).
 */
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { MessageView, TopicDetail } from '@juno/contract'
import { broadcastMessage, copyText, forwardSheetAtom, junoAvailableAtom, messageLink, registry, signedInAtom, threadRootTs } from '@juno/state'
import { junoNavAtom, watchReply } from '@juno/state/agent'
import type { MenuPoint, MessageMenuEntry, MessageMenuIcon } from '@juno/views'
import { askJunoAboutSelection } from '../juno/actions'
import type { ComposerHandle } from '../messageActions'
import { openMessageMenu } from '../messageMenu'
import { isOwnEditable, landedTs, opensThread } from '../messageRows'
import { showPersonMenu } from '../notifyActions'
import { broadcastLabel, openTopicInSlack } from '../topicActions'
import type { ActionTopic } from '../topicSource'
import { rowOf, textOf, type Latest } from './messageCommands'

const SEPARATOR: MessageMenuEntry = { separator: true }
const item = (id: string, label: string, icon: MessageMenuIcon, disabled = false, shortcut?: string): MessageMenuEntry => ({ id, label, icon, ...(disabled ? { disabled } : {}), ...(shortcut === undefined ? {} : { shortcut }) })

export interface MenuFacts {
  readonly topic: Pick<ActionTopic, 'kind' | 'channel'>
  readonly message: MessageView
  /** Your own message, shown as a message: Edit and Delete…. */
  readonly editable: boolean
  readonly own: boolean
  /** Text selected inside this message: Copy and Quote take it. */
  readonly selection: string | undefined
  /** AI assist is on: Ask Juno. */
  readonly juno: boolean
  /** Tell me if nobody replies can be set up. */
  readonly mayWatch: boolean
}

/**
 * The rows, in groups: Start thread or Open thread (Main), Quote, Ask Juno;
 * Copy text, Forward…, Open in Slack with Copy Slack link at its end; on your own, Also send
 * to #eng (a thread reply) and Tell me if nobody replies; then Edit and Delete….
 * Rows whose key works on a focused message show it (`rowKeyAction`): T, Q, F, E and ⌫; R, More reactions,
 * names its key in its tooltip.
 */
export function topicMenuItems({ topic, message, editable, own, selection, juno, mayWatch }: MenuFacts): ReadonlyArray<MessageMenuEntry> {
  // Only a message Slack has can be shared or linked to.
  const linkable = message.pending === undefined
  // Only a reply Slack has, as Slack's own client offers it.
  const broadcastable = own && topic.kind === 'thread' && linkable && message.kind === 'message' && !message.root && !message.broadcast
  return [
    ...(opensThread(topic.kind, message) ? [item('reply', message.thread === undefined ? 'Start thread' : 'Open thread', 'thread', false, 'T')] : []),
    item('quote', 'Quote', 'quote', false, 'Q'),
    ...(juno ? [item('ask-juno', 'Ask Juno', 'juno')] : []),
    SEPARATOR,
    item('copy', selection === undefined ? 'Copy text' : 'Copy', 'copy'),
    item('forward', 'Forward…', 'forward', !forwardable(message), 'F'),
    // The channel opens in Slack; the link copied is the message's.
    { id: 'open-in-slack', label: 'Open in Slack', icon: 'slack', ...(linkable ? { trailing: { id: 'copy-link', label: 'Copy Slack link', icon: 'link' } } : {}) },
    ...(broadcastable || (own && linkable) ? [SEPARATOR] : []),
    ...(broadcastable ? [item('broadcast', broadcastLabel(topic.channel), 'broadcast')] : []),
    ...(own && linkable ? [item('watch-reply', 'Tell me if nobody replies', 'bell', !mayWatch)] : []),
    ...(editable ? [SEPARATOR, item('edit', 'Edit', 'edit', false, 'E'), item('delete', 'Delete…', 'delete', false, '⌫')] : []),
  ]
}

/** The text selected inside this row's words, or undefined. */
function selectionIn(row: HTMLElement | null): string | undefined {
  const current = window.getSelection()
  if (row === null || current === null || current.isCollapsed || current.rangeCount === 0) return undefined
  const range = current.getRangeAt(0)
  const inText = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('[data-msg-text]') != null && row.contains(node)
  if (!inText(range.startContainer) || !inText(range.endContainer)) return undefined
  const text = current.toString().trim()
  return text === '' ? undefined : text
}

/** Ask Juno on a whole message: its words become the selection Ask Juno takes. */
function selectWords(scroller: HTMLElement | null, ts: string): void {
  const body = rowOf(scroller, ts)?.querySelector<HTMLElement>('[data-msg-text]')
  const selection = window.getSelection()
  if (body == null || selection === null) return
  const range = document.createRange()
  range.selectNodeContents(body)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Only a message Slack has, with words or files, can be forwarded. */
export const forwardable = (message: MessageView) => message.pending === undefined && message.kind === 'message'

/** Forward… opens the sheet with the message as the list shows it, its sender and where it was posted (SPEC 7, "Forward"). */
function openForward(channel: string, message: MessageView, { list, detail }: NonNullable<Latest['current']>): void {
  const sender = message.senderId === undefined ? undefined : list.refs.people.get(message.senderId)
  registry.set(forwardSheetAtom, { channelId: channel, message, sender, place: detail.channel.label })
}

/** What the menu needs from the topic, created once per topic (`useMessageCommands`). */
export interface MenuInput {
  readonly channel: string
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly composer: RefObject<ComposerHandle | null>
  readonly latest: Latest
  readonly setMenuMessage: Dispatch<SetStateAction<string | undefined>>
  /** Toggles your reaction; `on` forces it. */
  readonly react: (message: MessageView, name: string, on?: boolean) => void
  readonly startEdit: (message: MessageView) => void
  readonly askDelete: (message: MessageView) => void
  /** Opens the message's thread; `newTab` puts it in a background tab. */
  readonly reply: (message: MessageView, options?: { readonly newTab: boolean }) => void
}

/**
 * A row was chosen, on the message as it is now. `selection` is what was
 * selected in it when the menu opened. ⌘ on Start thread or Open thread opens
 * it in a background tab: this tab, its scroll and its focus stay (SPEC 7).
 */
function choose(id: string, now: MessageView, input: MenuInput, selection: string | undefined, metaKey: boolean): void {
  const { channel, scrollRef, composer, latest, startEdit, askDelete, reply } = input
  const { detail } = latest.current
  const text = () => selection ?? textOf(scrollRef.current, now.ts)
  switch (id) {
    case 'reply':
      return reply(now, { newTab: metaKey })
    case 'quote':
      if (selection !== undefined) window.getSelection()?.removeAllRanges()
      return composer.current?.quote(text())
    case 'ask-juno':
      if (selection === undefined) selectWords(scrollRef.current, now.ts)
      return void askJunoAboutSelection()
    case 'copy':
      return void copyText(text())
    case 'forward':
      return forwardable(now) ? openForward(channel, now, latest.current) : undefined
    case 'open-in-slack':
      return openTopicInSlack(detail)
    case 'copy-link':
      return copyMessageLink(detail, now)
    case 'broadcast':
      // Main shows the reply at once and the thread marks it; the outbox sends it. The engine refuses a reply deleted meanwhile.
      return void broadcastMessage(registry, { channelId: detail.channel.id, ts: now.ts })
    case 'watch-reply':
      return void watchReply(registry, { channelId: detail.channel.id, ts: now.ts, ...(detail.kind === 'thread' && detail.rootTs ? { threadTs: detail.rootTs } : {}) })
    case 'edit':
      return isOwnEditable(now) ? startEdit(now) : undefined
    case 'delete':
      return isOwnEditable(now) ? askDelete(now) : undefined
  }
}

/**
 * Copy Slack link: the message's own link. A reply carries its thread's
 * root: the thread's in a thread, the one it was sent from in Main.
 */
function copyMessageLink(detail: TopicDetail, message: MessageView): void {
  const session = registry.get(signedInAtom)
  if (session === undefined || message.pending !== undefined) return
  const threadTs = detail.kind === 'thread' ? detail.rootTs : message.broadcastFrom === undefined ? undefined : threadRootTs(message.broadcastFrom.id)
  void copyText(messageLink(session.workspaceUrl, detail.channel.id, message.ts, threadTs))
}

/** F on a focused message: Forward…, as the menu's row does. */
export function topicForward(input: MenuInput, message: MessageView): void {
  if (forwardable(message)) openForward(input.channel, message, input.latest.current)
}

/**
 * A message's menu at `anchor`; on the sender's name or avatar, someone else's person menu. `picking` opens it as
 * the full emoji picker, at once (R on a focused message).
 */
export function topicMenu(input: MenuInput, message: MessageView, anchor: MenuPoint, onSender: boolean, picking = false): void {
  const { scrollRef, latest, setMenuMessage, react } = input
  const { detail, list } = latest.current
  const own = message.senderId !== undefined && message.senderId === registry.get(signedInAtom)?.userId
  if (onSender && message.senderId !== undefined && !own) {
    void showPersonMenu({ id: message.senderId, name: list.refs.people.get(message.senderId)?.name ?? message.senderId }, anchor)
    return
  }
  // The message as it is now: it may have been edited, deleted or have landed while the menu was open.
  const current = () => {
    const rows = latest.current.list.rows
    return rows.get(message.ts) ?? rows.get(landedTs(rows, message.ts) ?? '')
  }
  const selection = selectionIn(rowOf(scrollRef.current, message.ts))
  const facts: MenuFacts = {
    topic: detail,
    message,
    editable: isOwnEditable(message),
    own,
    selection,
    juno: registry.get(junoAvailableAtom),
    mayWatch: registry.get(junoNavAtom).mayAuthorize === true,
  }
  setMenuMessage(message.ts)
  openMessageMenu({
    anchor,
    ...(picking ? { picking } : {}),
    items: topicMenuItems(facts),
    chosen: (emoji) => message.reactions.some((reaction) => reaction.me && reaction.name === emoji.name),
    onReact: (name) => {
      const now = current()
      if (now !== undefined) react(now, name)
    },
    onSelect: (id, { metaKey }) => {
      const now = current()
      if (now !== undefined) choose(id, now, input, selection, metaKey)
    },
    onClosed: () => setMenuMessage((ts) => (ts === message.ts ? undefined : ts)),
  })
}
