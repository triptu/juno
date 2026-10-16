/**
 * New chat (spec section 9): what each New chat tab holds, the pickers'
 * live queries. Sending is `send.ts`.
 *
 * A New chat tab keeps its draft and its destination in `newChatAtom(tabId)`,
 * so they survive every change of destination and a switch to another tab.
 * They are saved with the tab (`setNewChat` in `tabs.ts`) and read back from
 * it after a restart, as a topic's draft is. The destination is a
 * conversation and, inside it, a thread or Main (no thread).
 */
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { newChatConversations, newChatThreads, newChatFrequent, type MentionPick, type PickConversation, type PickThread, type SendTarget } from '@juno/contract'
import { liveQuery } from './atoms'
import { savedNewChatAtom } from './tabs'

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

/** Changed in this run of the app, by tab id. Until the first change, the saved one shows. */
const changedNewChatAtom = Atom.family((_tabId: string) => Atom.make<NewChat | undefined>(undefined).pipe(Atom.keepAlive))

/** Each New chat tab's draft and destination, by tab id. Write it with `setNewChat`, which also saves it. */
export const newChatAtom = Atom.family((tabId: string) =>
  Atom.writable(
    (get): NewChat => get(changedNewChatAtom(tabId)) ?? get(savedNewChatAtom(tabId)) ?? emptyNewChat,
    (ctx, value: NewChat) => ctx.set(changedNewChatAtom(tabId), value),
  ).pipe(Atom.keepAlive),
)

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

/** Local frequent destinations; subscribing never delays New chat’s first paint. */
export const frequentConversationsAtom = liveQuery(newChatFrequent)(undefined)
