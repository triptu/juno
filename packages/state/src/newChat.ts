/**
 * New chat (spec section 9): what each New chat tab holds, the pickers'
 * live queries. Sending is `send.ts`.
 *
 * A New chat tab keeps its draft and its destination in `newChatAtom(tabId)`
 * while the app runs, so they survive every change of destination and a
 * switch to another tab. The destination is a conversation and, inside it,
 * a thread or Main (no thread).
 */
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { newChatConversations, newChatThreads, type MentionPick, type PickConversation, type PickThread, type SendTarget } from '@juno/contract'
import { liveQuery } from './atoms'

export interface NewChat {
  /** The text as the field shows it. */
  readonly draft: string
  /** The people and channels picked from the @ and # suggestions; the send encodes them (`encodeMentions`). */
  readonly mentions: ReadonlyArray<MentionPick>
  readonly conversation: PickConversation | undefined
  /** A thread in `conversation`; none is Main. */
  readonly thread: PickThread | undefined
}

export const emptyNewChat: NewChat = { draft: '', mentions: [], conversation: undefined, thread: undefined }

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

/** What a picker reads while its list is closed: nothing, and no subscription. */
const closed = Atom.make(AsyncResult.initial<never, never>())

/** The conversation picker's sections for a query, while its list is open. */
export const pickConversationsAtom = (query: string | undefined) => (query === undefined ? closed : conversationsFamily({ query }))

/** The thread picker's rows, while its list is open: a channel's threads, or recent ones everywhere. */
export const pickThreadsAtom = (open: { readonly channel?: string | undefined; readonly query: string } | undefined) =>
  open === undefined ? closed : threadsFamily({ ...(open.channel === undefined ? {} : { channel: open.channel }), query: open.query })
