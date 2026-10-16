import type { ClarityFinding } from '@juno/contract'
import * as Atom from 'effect/reactivity/Atom'
import type { Registry } from './client'
import { currentPlace, tabsAtom } from './tabs'

interface SentMessage {
  readonly clientMsgId: string
  readonly topicId: string
  readonly original: string
  readonly sentAt: number
}
export interface SentSuggestion extends SentMessage { readonly finding: ClarityFinding }

/** Ephemeral UI only: never persisted, replayed on navigation, or queued. */
const latestSentAtom = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive)
export const sentSuggestionAtom = Atom.make<SentSuggestion | undefined>(undefined).pipe(Atom.keepAlive)
export const dismissSentSuggestion = (registry: Registry) => registry.set(sentSuggestionAtom, undefined)

export function watchSentMessage(registry: Registry, sent: SentMessage): (finding: ClarityFinding | undefined) => void {
  dismissSentSuggestion(registry)
  registry.set(latestSentAtom, sent.clientMsgId)
  let left = false
  const visible = () => {
    const tabs = registry.get(tabsAtom)
    const active = tabs.tabs.find((tab) => tab.id === tabs.active)
    return active === undefined ? undefined : currentPlace(active)
  }
  // New chat becomes its sent topic as soon as the send command returns.
  const initial = visible()
  const unsubscribe = registry.subscribe(tabsAtom, () => {
    const place = visible()
    if (place?.kind === 'topic' && place.topicId === sent.topicId) return
    if (initial?.kind === 'newChat' && place?.kind === 'newChat') return
    left = true
    if (registry.get(sentSuggestionAtom)?.clientMsgId === sent.clientMsgId) dismissSentSuggestion(registry)
  })
  const cleanup = () => { unsubscribe(); clearTimeout(expiry) }
  const expiry = setTimeout(() => {
    if (registry.get(sentSuggestionAtom)?.clientMsgId === sent.clientMsgId) dismissSentSuggestion(registry)
    cleanup()
  }, 8000)
  return (finding) => {
    const place = visible()
    if (registry.get(latestSentAtom) !== sent.clientMsgId || finding === undefined || left || performance.now() - sent.sentAt >= 1000 || place?.kind !== 'topic' || place.topicId !== sent.topicId) {
      cleanup()
      return
    }
    registry.set(sentSuggestionAtom, { ...sent, finding })
  }
}
