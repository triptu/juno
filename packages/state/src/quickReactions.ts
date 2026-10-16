/**
 * The quick reactions (SPEC 7, 14): the one-click reactions in the message
 * toolbar, in order, up to seven. One workspace preference in user.db,
 * `quickReactions`; 👍 ✅ 👀 until the user chooses.
 */
import * as Atom from 'effect/reactivity/Atom'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { DEFAULT_QUICK_REACTIONS, prefsGet, prefsSet, QUICK_REACTIONS_PREF, quickReactionsFrom, type QuickReaction } from '@juno/contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'

const savedQuickReactionsAtom = liveQuery(prefsGet)({ key: QUICK_REACTIONS_PREF })

/** The quick reactions of the open workspace. The default three until the preference arrives. */
export const quickReactionsAtom = Atom.make((get): ReadonlyArray<QuickReaction> => {
  const saved = get(savedQuickReactionsAtom)
  return AsyncResult.isSuccess(saved) ? quickReactionsFrom(saved.value) : DEFAULT_QUICK_REACTIONS
})

/** Saves the list. The default list is saved as no preference, so a later change of default reaches it. */
export function setQuickReactions(registry: Registry, reactions: ReadonlyArray<QuickReaction>) {
  const isDefault = reactions.length === DEFAULT_QUICK_REACTIONS.length && reactions.every((reaction, i) => reaction.name === DEFAULT_QUICK_REACTIONS[i]!.name)
  const value = isDefault ? null : reactions.map((reaction) => (reaction.url === undefined ? { name: reaction.name, unicode: reaction.unicode } : { name: reaction.name, unicode: reaction.unicode, url: reaction.url }))
  return runCommand(registry, prefsSet, { key: QUICK_REACTIONS_PREF, value })
}
