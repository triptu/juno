/**
 * New chat (spec section 9): what each New chat tab holds, the pickers'
 * live queries and the send.
 *
 * A New chat tab keeps its draft and its destination in `newChatAtom(tabId)`
 * while the app runs, so they survive every change of destination and a
 * switch to another tab. The destination is a conversation and, inside it,
 * a thread or Main (no thread).
 */
import * as Atom from 'effect/reactivity/Atom'
import { messagesSend, newChatConversations, newChatThreads, type PickConversation, type PickThread, type SendTarget } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

export interface NewChat {
  readonly draft: string
  readonly conversation: PickConversation | undefined
  /** A thread in `conversation`; none is Main. */
  readonly thread: PickThread | undefined
}

export const emptyNewChat: NewChat = { draft: '', conversation: undefined, thread: undefined }

/** Each New chat tab's draft and destination, by tab id. */
export const newChatAtom = Atom.family((_tabId: string) => Atom.make<NewChat>(emptyNewChat).pipe(Atom.keepAlive))

/** Nothing written and nothing picked: ⌘N focuses this tab instead of opening another. */
export const untouched = (chat: NewChat): boolean => chat.draft.trim() === '' && chat.conversation === undefined

/** The tab's title: "New chat" until a destination is picked, then the thread's title or the conversation's name. */
export const newChatTitle = (chat: NewChat): string => chat.thread?.title ?? chat.conversation?.name ?? 'New chat'

/** Picks a conversation. A new one sets the thread back to Main. */
export const pickConversation = (chat: NewChat, conversation: PickConversation): NewChat =>
  chat.conversation?.key === conversation.key ? chat : { ...chat, conversation, thread: undefined }

/** Picks a thread, or Main with `undefined`. A thread also sets its conversation. */
export const pickThread = (chat: NewChat, thread: PickThread | undefined): NewChat =>
  thread === undefined ? { ...chat, thread: undefined } : { ...chat, conversation: thread.conversation, thread }

/** The topic the preview shows: the thread, or the conversation's Main. None for a person never messaged. */
export const previewTopic = (chat: NewChat): string | undefined => chat.thread?.id ?? chat.conversation?.mainId

/** Where `messages.send` posts the draft, once a conversation is picked. */
export function sendTarget(chat: NewChat): SendTarget | undefined {
  const conversation = chat.conversation
  if (conversation === undefined) return undefined
  if (conversation.channelId === undefined) return { kind: 'person', userId: conversation.person?.id ?? conversation.key.slice('u:'.length) }
  return { kind: 'channel', channelId: conversation.channelId, ...(chat.thread === undefined ? {} : { threadTs: chat.thread.rootTs }) }
}

const conversationsFamily = liveQuery(newChatConversations)
const threadsFamily = liveQuery(newChatThreads)

/** The conversation picker's sections for a query. */
export const pickConversationsAtom = (query: string) => conversationsFamily({ query })

/** The thread picker's rows: a conversation's threads, or recent ones everywhere. */
export const pickThreadsAtom = (channel: string | undefined, query: string) => threadsFamily({ ...(channel === undefined ? {} : { channel }), query })

/** Sends the draft. Resolves with the `Exit`; on success, the topic the message landed in. */
export const sendMessage = (registry: Registry, to: SendTarget, text: string) => runCommand(registry, messagesSend, { to, text, clientMsgId: crypto.randomUUID() })
