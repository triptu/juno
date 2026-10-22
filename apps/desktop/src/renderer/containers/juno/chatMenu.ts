/**
 * The menu on a Juno chat message (SPEC 13.1, "Message menu"). Loaded with
 * the menu, when idle (`../messageMenu.tsx`).
 */
import { chatCopy, junoText, type ChatItem, type MessageMenu as Removal } from '@juno/agent-contract'
import { copyText, noteRecentEmoji, registry } from '@juno/state'
import { messageActions } from '@juno/state/agent'
import type { ChatMenuTarget, MenuPoint, MessageMenuEntry, ReactionTarget } from '@juno/views'
import { openMessageMenu } from '../messageMenu'
import { junoCommands } from './actions'

const messages = messageActions(registry)

/** Words selected in the message when its menu opened, as the agent counts them. */
export interface ChatSpan {
  readonly text: string
  readonly startByte: number
  readonly endByte: number
}

/** The owner's current reaction on a bubble or card: one each. */
function ownReaction(items: ReadonlyArray<ChatItem>, target: ReactionTarget): string | undefined {
  const item = items.find((i) => (target._tag === 'bubble' ? i._tag === 'juno' && i.id === target.id : i._tag === 'card' && i.card.id === target.id))
  const reactions = item?._tag === 'juno' || item?._tag === 'card' ? item.reactions : []
  return reactions.find((reaction) => reaction.by === 'owner')?.emoji
}

/**
 * On a Juno bubble or card: the emoji grid, then Reply and Copy, then
 * Remove…. On your own: Copy and Remember this, then Remove…, with no grid,
 * since your own messages take no reaction. It shows at once; Remove… and
 * Remember this wait for the agent's answer about the message, and show
 * disabled when it has none.
 */
export function openChatMenu(
  target: ChatMenuTarget,
  anchor: MenuPoint,
  items: ReadonlyArray<ChatItem>,
  selection: ChatSpan | undefined,
  remove: (message: typeof Removal.Type) => void,
  reply: (target: ReactionTarget) => void,
): void {
  const copy = chatCopy.contextMenu
  const reaction: ReactionTarget | undefined = target.kind === 'juno' ? { _tag: 'bubble', id: target.id } : target.kind === 'card' ? { _tag: 'card', id: target.id } : undefined
  const pending = messages.menu(target.kind === 'owner' ? { _tag: 'owner', opId: target.opId } : target.kind === 'juno' ? { _tag: 'bubble', id: target.id } : { _tag: 'card', id: target.id })
  const item = items.find((i) => (target.kind === 'owner' ? i._tag === 'owner' && i.opId === target.opId : target.kind === 'juno' ? i._tag === 'juno' && i.id === target.id : false))
  const text = item?._tag === 'owner' ? item.text : item?._tag === 'juno' ? junoText(item.body) : ''
  const span = selection ?? { text, startByte: 0, endByte: new TextEncoder().encode(text).length }
  const pinnable = span.endByte - span.startByte > 0 && span.endByte - span.startByte <= 280
  const entries = (known: boolean): ReadonlyArray<MessageMenuEntry> => [
    ...(reaction !== undefined ? [{ id: 'reply', label: chatCopy.react.reply, icon: 'reply' } as const] : []),
    { id: 'copy', label: copy.copy, icon: 'copy' },
    ...(reaction === undefined ? [{ id: 'remember', label: copy.remember, icon: 'pin', ...(known && pinnable ? {} : { disabled: true }) } as const] : []),
    { separator: true },
    { id: 'remove', label: `${copy.remove}…`, icon: 'delete', ...(known ? {} : { disabled: true }) },
  ]
  // Choosing your current reaction again takes it back; another replaces it.
  const mine = reaction === undefined ? undefined : ownReaction(items, reaction)
  const update = openMessageMenu({
    anchor,
    items: entries(true),
    noGrid: reaction === undefined,
    chosen: (emoji) => (emoji.url === undefined ? emoji.unicode : emoji.name) === mine,
    onReact: (name, unicode) => {
      if (reaction === undefined) return
      noteRecentEmoji(name)
      const emoji = unicode ?? name
      void junoCommands.react(reaction, emoji === mine ? null : emoji)
    },
    onSelect: (id) => {
      switch (id) {
        case 'copy':
          return copyText(span.text)
        case 'reply':
          return reaction === undefined ? undefined : reply(reaction)
        case 'remember':
          return void pending.then((message) => (message === null ? undefined : messages.pin(message, span.startByte, span.endByte)))
        case 'remove':
          return void pending.then((message) => (message === null ? undefined : remove(message)))
      }
    },
  })
  void pending.then((message) => {
    if (message === null) update({ items: entries(false) })
  })
}
