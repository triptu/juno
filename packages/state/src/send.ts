/**
 * Sending and drafts (spec sections 8 and 9; architecture 5.7).
 *
 * `sendMessage` queues a message and answers at once with its topic; the
 * message shows as a pending row in `messages.list` until Slack has it.
 * Drafts live in the engine per topic, so they outlive tabs and restarts;
 * the composer reads one once and writes it back as the user types.
 */
import { draftsGet, draftsSet, messagesDiscard, messagesRetry, messagesSend, type SendTarget } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

/** Queues the text for `to`. With `draftOf`, that topic's draft is cleared with it. Resolves with the `Exit`; on success, the topic. */
export const sendMessage = (registry: Registry, to: SendTarget, text: string, draftOf?: string) =>
  runCommand(registry, messagesSend, { to, text, clientMsgId: crypto.randomUUID(), ...(draftOf === undefined ? {} : { draftOf }) })

/** Retry on a failed row. */
export const retryMessage = (registry: Registry, clientMsgId: string) => runCommand(registry, messagesRetry, { clientMsgId })

/** Delete draft on a failed row. */
export const discardMessage = (registry: Registry, clientMsgId: string) => runCommand(registry, messagesDiscard, { clientMsgId })

const draftFamily = liveQuery(draftsGet)

/** A topic's draft, `''` when it has none. */
export const draftAtom = (topicId: string) => draftFamily({ topicId })

/** Replaces a topic's draft; an empty text deletes it. */
export const saveDraft = (registry: Registry, topicId: string, text: string) => runCommand(registry, draftsSet, { topicId, text })
