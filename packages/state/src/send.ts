/**
 * Sending and drafts (spec sections 8 and 9; architecture 5.7).
 *
 * `sendMessage` queues a message and answers at once with its topic; the
 * message shows as a pending row in `messages.list` until Slack has it.
 * Drafts live in the engine per topic, so they outlive tabs and restarts;
 * the composer reads one once and writes it back as the user types.
 * `precheckMessage` asks the route model while typing pauses in Main;
 * `checkMessage` runs the checks on send before the composer sends, with no
 * model in the way. The other checks run once the send is accepted, and their
 * fix line waits on the sent message (`sentSuggestions.ts`).
 */
import {
  decodeDraft,
  draftsGet,
  draftsSet,
  messagesCheck,
  messagesGrammar,
  messagesPrecheck,
  messagesPostcheck,
  messagesDelete,
  messagesDiscard,
  messagesEdit,
  messagesAttachmentAction,
  messagesBroadcast,
  messagesReact,
  messagesResolveAction,
  messagesRetry,
  messagesSend,
  sendChecksApply,
  type MessageRef,
  type SendCheck,
  type SendTarget,
} from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { traceSend } from './sendTrace'
import { offerSentSuggestion } from './sentSuggestions'
import { releaseSidebarTopic } from './sidebar'

/** The topic a send to a conversation lands in, before the engine answers (architecture 4.4); undefined for a person, or a thread not yet in Slack. */
const targetTopic = (to: SendTarget): string | undefined =>
  to.kind !== 'channel' ? undefined : to.threadTs === undefined ? `m:${to.channelId}` : to.threadTs.startsWith('pending:') ? undefined : `t:${to.channelId}:${to.threadTs}`

/**
 * Queues the text, and any staged `files`, for `to`. With `draftOf`, that topic's draft is cleared with it.
 * Resolves with the `Exit`; on success, the topic.
 */
export const sendMessage = async (registry: Registry, to: SendTarget, text: string, draftOf?: string, files?: ReadonlyArray<string>, startThread = false) => {
  const clientMsgId = crypto.randomUUID()
  const sentAt = performance.now()
  traceSend('send asked', () => ({ clientMsgId: clientMsgId.slice(0, 8), to }))
  // Your own send moves its row at once, even while the sidebar holds its order: released before the engine's
  // list can show it, so the row never shows the words in its held place first.
  const known = targetTopic(to)
  if (known !== undefined) releaseSidebarTopic(registry, known)
  const exit = await runCommand(registry, messagesSend, {
    to, text, startThread, clientMsgId,
    ...(draftOf === undefined ? {} : { draftOf }),
    ...(files === undefined || files.length === 0 ? {} : { files }),
  })
  traceSend('send answered', () => ({ clientMsgId: clientMsgId.slice(0, 8), ok: exit._tag === 'Success', ...(exit._tag === 'Success' ? { topicId: exit.value.topicId } : {}) }))
  // A new DM's topic, or a thread you started, is known only now.
  if (exit._tag === 'Success') releaseSidebarTopic(registry, exit.value.topicId)
  // The line belongs to the text as the field showed it, which is what the message's edit text is.
  if (exit._tag === 'Success' && sendChecksApply(text)) void checkSent(registry, { clientMsgId, original: decodeDraft(text).text, sentAt })
  return exit
}

/** Local fixes show as soon as they are found; a grammar answer, whenever it comes, replaces them with the merged list. */
async function checkSent(registry: Registry, sent: { readonly clientMsgId: string; readonly original: string; readonly sentAt: number }) {
  const local = await runCommand(registry, messagesPostcheck, { clientMsgId: sent.clientMsgId })
  if (local._tag !== 'Success') return
  if (local.value.clarity !== undefined) offerSentSuggestion(registry, sent, local.value.clarity)
  if (!local.value.grammar) return
  const grammar = await runCommand(registry, messagesGrammar, { clientMsgId: sent.clientMsgId })
  if (grammar._tag === 'Success' && grammar.value.clarity !== undefined) offerSentSuggestion(registry, sent, grammar.value.clarity)
}

/**
 * The longest a send waits for its checks. They read the store only, so
 * this is a guard against a busy engine, not a model's timeout.
 */
export const SEND_CHECK_WAIT_MS = 250

/**
 * The checks on send for `text` going to the channel (spec section 8).
 * Resolves with what they found: empty when nothing was, and when they
 * failed or did not answer within `SEND_CHECK_WAIT_MS`.
 */
export function checkMessage(registry: Registry, to: { readonly channelId: string; readonly threadTs?: string }, text: string): Promise<SendCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<SendCheck>((resolve) => {
    timer = setTimeout(() => resolve({}), SEND_CHECK_WAIT_MS)
  })
  const checked = runCommand(registry, messagesCheck, { ...to, text }).then((exit): SendCheck => (exit._tag === 'Success' ? exit.value : {}))
  return Promise.race([checked, late]).finally(() => clearTimeout(timer))
}

/** In Main, asks the route model about the draft so Enter finds a ready answer. Grammar waits for the send. */
export function precheckMessage(registry: Registry, channelId: string, text: string, threadTs?: string): void {
  if (threadTs !== undefined || !sendChecksApply(text)) return
  void runCommand(registry, messagesPrecheck, { channelId, text })
}

/** Retry on a failed row. */
export const retryMessage = (registry: Registry, clientMsgId: string) => runCommand(registry, messagesRetry, { clientMsgId })

/** Delete draft on a failed row. */
export const discardMessage = (registry: Registry, clientMsgId: string) => runCommand(registry, messagesDiscard, { clientMsgId })

/** Edits an own message. The list shows the new text at once; the outbox sends it. */
export const editMessage = (registry: Registry, message: MessageRef, text: string) => runCommand(registry, messagesEdit, { message, text })

/** Deletes an own message. It leaves the list at once; the outbox sends it. */
export const deleteMessage = (registry: Registry, message: MessageRef) => runCommand(registry, messagesDelete, { message })

/** Also sends an own thread reply to the channel. Main shows it at once; the outbox sends it. */
export const broadcastMessage = (registry: Registry, message: MessageRef) => runCommand(registry, messagesBroadcast, { message })

/** Adds (`on`) or removes the user's reaction `name`. The chip changes at once; the outbox sends it. */
export const reactToMessage = (registry: Registry, message: MessageRef, name: string, on: boolean) => runCommand(registry, messagesReact, { message, name, on })

/** Presses a button in a message, such as Slackbot's Add Them. Slack is called at once; what the press changes comes back on the socket. */
export const pressMessageButton = (registry: Registry, message: MessageRef, attachment: string, button: string) =>
  runCommand(registry, messagesAttachmentAction, { message, attachment, button })

const draftFamily = liveQuery(draftsGet)

/** A topic's draft, `''` when it has none. */
export const draftAtom = (topicId: string) => draftFamily({ topicId })

/** Replaces a topic's draft; an empty text deletes it. */
export const saveDraft = (registry: Registry, topicId: string, text: string) => runCommand(registry, draftsSet, { topicId, text })

export const resolveMessageAction = (registry: Registry, id: number, retry: boolean) => runCommand(registry, messagesResolveAction, { id, retry })
