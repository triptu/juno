/**
 * The Juno panel beside a topic (SPEC 7, inventory 12.1): renderer state the
 * agent does not keep.
 *
 * - `junoPanelOpenAtom`: whether the panel is open, one flag for every topic
 *   tab, saved to the workspace preference `JUNO_PANEL_PREF`.
 * - `junoAboutAtom`: the About chip from Ask Juno in a person's or channel's
 *   menu. It holds until removed or the panel closes.
 * - `openedAtNewAtom(topicId)`: the first message under the "new" divider the
 *   topic opened at, set by the topic view. The panel offers Catch me up
 *   until a message about the topic is sent from it (`catchUpDoneAtom`).
 * - `junoFocusAtom`: bumped to ask the visible Juno composer for focus (⌘J,
 *   Ask Juno), so the request reaches a composer that mounts after it.
 */
import { Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { prefsGet, prefsSet } from '@juno/contract'
import type { About } from '@juno/agent-contract'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { signedInAtom } from './session'

export const JUNO_PANEL_PREF = 'junoPanel'

const savedPanelAtom = liveQuery(prefsGet)({ key: JUNO_PANEL_PREF })
const changedPanelAtom = Atom.family((_teamId: string) => Atom.make<boolean | undefined>(undefined).pipe(Atom.keepAlive))
const decodeOpen = Schema.decodeUnknownOption(Schema.Struct({ open: Schema.Boolean }))

export const junoPanelOpenAtom = Atom.make((get): boolean => {
  const teamId = get(signedInAtom)?.teamId
  if (teamId === undefined) return false
  const changed = get(changedPanelAtom(teamId))
  if (changed !== undefined) return changed
  const saved = get(savedPanelAtom)
  if (!AsyncResult.isSuccess(saved)) return false
  const decoded = decodeOpen(saved.value)
  return decoded._tag === 'Some' && decoded.value.open
})

export function setJunoPanelOpen(registry: Registry, open: boolean): void {
  const teamId = registry.get(signedInAtom)?.teamId
  if (teamId === undefined || registry.get(junoPanelOpenAtom) === open) return
  registry.set(changedPanelAtom(teamId), open)
  if (!open) registry.set(junoAboutAtom, undefined)
  void runCommand(registry, prefsSet, { key: JUNO_PANEL_PREF, value: { open } })
}

export const junoAboutAtom = Atom.make<Exclude<About, { _tag: 'topic' }> | undefined>(undefined).pipe(Atom.keepAlive)

export const openedAtNewAtom = Atom.family((_topicId: string) => Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive))
export const catchUpDoneAtom = Atom.family((_topicId: string) => Atom.make(false).pipe(Atom.keepAlive))

/** A request for the Juno tab's or the panel's composer to take focus; `n` counts requests, so each is taken once. */
export interface JunoFocusRequest {
  readonly n: number
  readonly where: 'tab' | 'panel'
}

export const junoFocusAtom = Atom.make<JunoFocusRequest>({ n: 0, where: 'tab' }).pipe(Atom.keepAlive)

export function focusJunoComposer(registry: Registry, where: JunoFocusRequest['where']): void {
  registry.set(junoFocusAtom, { n: registry.get(junoFocusAtom).n + 1, where })
}

/**
 * A message a topic should show and flash once it is on screen: a Juno
 * source link opened it (SPEC 13.1). `n` counts requests, so the same
 * message asked twice flashes twice.
 */
export const messageFlashAtom = Atom.family((_topicId: string) => Atom.make<{ readonly ts: string; readonly n: number } | undefined>(undefined).pipe(Atom.keepAlive))

export function flashMessage(registry: Registry, topicId: string, ts: string): void {
  registry.set(messageFlashAtom(topicId), { ts, n: (registry.get(messageFlashAtom(topicId))?.n ?? 0) + 1 })
}
