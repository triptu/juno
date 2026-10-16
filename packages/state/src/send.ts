/**
 * Sending and drafts (spec sections 8 and 9; architecture 5.7).
 *
 * `sendMessage` queues a message and answers at once with its topic; the
 * message shows as a pending row in `messages.list` until Slack has it.
 * Drafts live in the engine per topic, so they outlive tabs and restarts;
 * the composer reads one once and writes it back as the user types.
 * `precheckMessage` asks the model while typing pauses; `checkMessage` runs
 * the checks on send before the composer sends, with no model in the way.
 */
import {
  draftsGet,
  draftsSet,
  messagesCheck,
  messagesPrecheck,
  messagesDelete,
  messagesDiscard,
  messagesEdit,
  messagesReact,
  messagesRetry,
  messagesSend,
  type MessageRef,
  type SendCheck,
  type SendTarget,
} from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

/**
 * Queues the text, and any staged `files`, for `to`. With `draftOf`, that topic's draft is cleared with it.
 * Resolves with the `Exit`; on success, the topic.
 */
export const sendMessage = (registry: Registry, to: SendTarget, text: string, draftOf?: string, files?: ReadonlyArray<string>, startThread = false) =>
  runCommand(registry, messagesSend, {
    to,
    text,
    startThread,
    clientMsgId: crypto.randomUUID(),
    ...(draftOf === undefined ? {} : { draftOf }),
    ...(files === undefined || files.length === 0 ? {} : { files }),
  })

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

/** Asks the wrong-place question for a Main draft now, so Enter finds the answer. Nothing to wait for. */
export function precheckMessage(registry: Registry, channelId: string, text: string): void {
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

/** Adds (`on`) or removes the user's reaction `name`. The chip changes at once; the outbox sends it. */
export const reactToMessage = (registry: Registry, message: MessageRef, name: string, on: boolean) => runCommand(registry, messagesReact, { message, name, on })

const draftFamily = liveQuery(draftsGet)

/** A topic's draft, `''` when it has none. */
export const draftAtom = (topicId: string) => draftFamily({ topicId })

/** Replaces a topic's draft; an empty text deletes it. */
export const saveDraft = (registry: Registry, topicId: string, text: string) => runCommand(registry, draftsSet, { topicId, text })
