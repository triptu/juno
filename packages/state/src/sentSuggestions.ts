/**
 * The fix line on a sent message (SPEC section 8). Each message sent from
 * Juno can get one: local fixes as soon as the send is accepted, replaced by
 * the merged list when the grammar answer comes. It waits on the message,
 * whether or not its topic is in view, until it is reviewed or dismissed, and
 * the topic shows it whenever the message is in its list with the text sent.
 * Ephemeral UI only: never persisted or queued, and gone with the window.
 */
import type { ClarityFinding } from '@juno/contract'
import * as Atom from 'effect/reactivity/Atom'
import type { Registry } from './client'

/** A finding that comes later than this after its send is dropped (the engine's window too). */
export const SENT_SUGGESTION_WINDOW_MS = 120_000
/** The most fix lines kept at once; the oldest goes first. */
const KEPT = 50

interface SentMessage {
  readonly clientMsgId: string
  /** The text as sent: a line shows only while the message still has it. */
  readonly original: string
  /** `performance.now()` when Enter sent it. */
  readonly sentAt: number
}
export interface SentSuggestion extends SentMessage { readonly finding: ClarityFinding }

/**
 * The fix lines, by the message's `clientMsgId`. `null` is a line reviewed or dismissed, so a later grammar
 * answer does not bring it back.
 */
export const sentSuggestionsAtom = Atom.make<ReadonlyMap<string, SentSuggestion | null>>(new Map()).pipe(Atom.keepAlive)

/** Shows `finding` on the sent message, replacing the one it had, unless it came too late or the line was closed. */
export function offerSentSuggestion(registry: Registry, sent: SentMessage, finding: ClarityFinding): void {
  const current = registry.get(sentSuggestionsAtom)
  if (current.get(sent.clientMsgId) === null || performance.now() - sent.sentAt >= SENT_SUGGESTION_WINDOW_MS) return
  const next = new Map(current)
  next.delete(sent.clientMsgId)
  next.set(sent.clientMsgId, { ...sent, finding })
  for (const id of next.keys()) {
    if (next.size <= KEPT) break
    next.delete(id)
  }
  registry.set(sentSuggestionsAtom, next)
}

/** Review or Dismiss, or the message changed: the line goes for good. */
export function dismissSentSuggestion(registry: Registry, clientMsgId: string): void {
  const current = registry.get(sentSuggestionsAtom)
  if (current.get(clientMsgId) === null) return
  const next = new Map(current)
  next.delete(clientMsgId)
  next.set(clientMsgId, null)
  registry.set(sentSuggestionsAtom, next)
}
