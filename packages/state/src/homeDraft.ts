/**
 * What each Home tab is writing (SPEC section 12, "Writing"): the draft, the
 * @ and # picks inside it, and where it goes. No conversation is Juno.
 *
 * A Home tab keeps its draft in `homeDraftAtom(tabId)`, so it survives a
 * change of destination and a switch to another tab. It is saved with the
 * tab (`setHomeDraft` in `tabs.ts`) and read back from it after a restart,
 * as a topic's draft is. The conversation list's and Recent's live queries
 * are here; sending is `send.ts`.
 */
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { newChatConversations, newChatFrequent, type MentionPick, type PickConversation, type SendTarget } from '@juno/contract'
import { liveQuery } from './atoms'
import type { Registry } from './client'
import { savedHomeDraftAtom } from './tabs'

export interface HomeDraft {
  /** The text as the field shows it. */
  readonly draft: string
  /** The people and channels picked from the @ and # suggestions; the send encodes them (`encodeMentions`). */
  readonly mentions: ReadonlyArray<MentionPick>
  /** Where Enter sends; none is Juno. */
  readonly conversation: PickConversation | undefined
}

export const emptyHomeDraft: HomeDraft = { draft: '', mentions: [], conversation: undefined }

/** Changed in this run of the app, by tab id. Until the first change, the saved one shows. */
const changedHomeDraftAtom = Atom.family((_tabId: string) => Atom.make<HomeDraft | undefined>(undefined).pipe(Atom.keepAlive))

/** Each Home tab's draft and destination, by tab id. Write it with `setHomeDraft`, which also saves it. */
export const homeDraftAtom = Atom.family((tabId: string) =>
  Atom.writable(
    (get): HomeDraft => get(changedHomeDraftAtom(tabId)) ?? get(savedHomeDraftAtom(tabId)) ?? emptyHomeDraft,
    (ctx, value: HomeDraft) => ctx.set(changedHomeDraftAtom(tabId), value),
  ).pipe(Atom.keepAlive),
)

/** Nothing written and Juno chosen: ⌘N may use this Home rather than open another. */
export const untouched = (draft: HomeDraft): boolean => draft.draft.trim() === '' && draft.conversation === undefined

/** Chooses where the draft goes; `undefined` is Juno. The text stays. */
export const pickConversation = (draft: HomeDraft, conversation: PickConversation | undefined): HomeDraft =>
  draft.conversation?.key === conversation?.key ? draft : { ...draft, conversation }

/** Where `messages.send` posts the draft: a conversation's Main, or a DM opened first for a person never messaged. Juno has none. */
export function sendTarget(draft: HomeDraft): SendTarget | undefined {
  const conversation = draft.conversation
  if (conversation === undefined) return undefined
  if (conversation.channelId === undefined) return { kind: 'person', userId: conversation.person?.id ?? conversation.key.slice('u:'.length) }
  return { kind: 'channel', channelId: conversation.channelId }
}

const conversationsFamily = liveQuery(newChatConversations)

/** What a list reads while it is closed: nothing, and no subscription. */
const closed = Atom.make(AsyncResult.initial<never, never>())

/** The destination list's sections for a query, while a list is open (the chip's, or the first @ or #). */
export const pickConversationsAtom = (query: string | undefined) => (query === undefined ? closed : conversationsFamily({ query }))

/** Home's Recent: five people, then five channels (`frequentDestinations`). Local; subscribing never delays Home's first paint. */
export const frequentConversationsAtom = liveQuery(newChatFrequent)(undefined)

/** A request for a Home tab's composer to take focus (⌘N, ⌘T and "+"); with `list`, its destination list opens too (⌘N). */
export interface HomeFocus {
  readonly tabId: string
  readonly list: boolean
  /** New for every request, so the same request twice is two requests. */
  readonly seq: number
}

export const homeFocusAtom = Atom.make<HomeFocus | undefined>(undefined).pipe(Atom.keepAlive)

let focusSeq = 0

/** Asks the Home in `tabId` to focus its field, and with `list` to open its destination list. The tab takes it when it shows. */
export function requestHomeFocus(registry: Registry, tabId: string, list = false): void {
  registry.set(homeFocusAtom, { tabId, list, seq: ++focusSeq })
}
