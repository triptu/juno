/**
 * The Juno panel beside a topic (SPEC 7, inventory 12.1): renderer state the
 * agent does not keep.
 *
 * - `junoPanelOpenAtom`: whether the panel is open in the active tab. Each
 *   tab keeps its own flag, saved with the tabs (`Tab.junoPanel`), so the
 *   panel can be open in one tab and closed in another.
 * - `junoPanelWidthAtom`: the panel's width, one for every tab, saved to the
 *   workspace preference `JUNO_PANEL_PREF`.
 * - `junoAboutAtom`: the About chip from Ask Juno in a person's or channel's
 *   menu. It holds until removed or the panel closes.
 * - `openedAtNewAtom(topicId)`: the first message under the "new" divider the
 *   topic opened at, set by the topic view. The panel offers Catch me up
 *   until a message about the topic is sent from it (`catchUpDoneAtom`).
 * - `junoFocusAtom`: bumped to ask the visible Juno composer for focus (⌘J,
 *   Ask Juno), so the request reaches a composer that mounts after it.
 * - `junoQuoteAtom`: a message to quote in the panel's composer, from the
 *   why popover's Tell Juno (SPEC 14). The panel beside that topic takes it
 *   as its selection quote.
 */
import { Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { JUNO_PANEL_WIDTH, prefsGet, prefsSet } from '@juno/contract'
import type { About, Selection } from '@juno/agent-contract'
import { liveQuery, runCommand } from './atoms'
import { aiAssistOnAtom } from './notifications'
import type { Registry } from './client'
import { signedInAtom } from './session'
import { activeTab, setJunoPanel, tabsAtom, updateTabs } from './tabs'

export const JUNO_PANEL_PREF = 'junoPanel'

/**
 * Juno shows (the header's Juno button, ⌘J, Ask Juno, Home's field) unless
 * AI assist is off (SPEC 7). Whether a provider is set up decides only what
 * the Juno tab and panel show: the chat, or "Add a provider".
 */
export const junoAvailableAtom = aiAssistOnAtom

export const junoPanelOpenAtom = Atom.make((get): boolean => {
  const tabs = get(tabsAtom)
  return tabs.tabs.find((tab) => tab.id === tabs.active)?.junoPanel === true
})

/** Opens or closes the panel in the active tab. */
export function setJunoPanelOpen(registry: Registry, open: boolean): void {
  const tab = activeTab(registry.get(tabsAtom))
  if (tab === undefined || (tab.junoPanel === true) === open) return
  updateTabs(registry, (tabs) => setJunoPanel(tabs, tab.id, open))
  if (!open) registry.set(junoAboutAtom, undefined)
}

const savedPanelAtom = liveQuery(prefsGet)({ key: JUNO_PANEL_PREF })
const changedWidthAtom = Atom.family((_teamId: string) => Atom.make<number | undefined>(undefined).pipe(Atom.keepAlive))
const decodeWidth = Schema.decodeUnknownOption(Schema.Struct({ width: Schema.Number }))
const validWidth = (width: number) => Number.isInteger(width) && width >= JUNO_PANEL_WIDTH.min && width <= JUNO_PANEL_WIDTH.max

export const junoPanelWidthAtom = Atom.make((get): number => {
  const teamId = get(signedInAtom)?.teamId
  if (teamId === undefined) return JUNO_PANEL_WIDTH.default
  const changed = get(changedWidthAtom(teamId))
  if (changed !== undefined) return changed
  const saved = get(savedPanelAtom)
  if (!AsyncResult.isSuccess(saved)) return JUNO_PANEL_WIDTH.default
  const decoded = decodeWidth(saved.value)
  return decoded._tag === 'Some' && validWidth(decoded.value.width) ? decoded.value.width : JUNO_PANEL_WIDTH.default
})

/** A drag on the panel's edge ended at `width`, or a double-click asked for the default. */
export function setJunoPanelWidth(registry: Registry, width: number): void {
  const teamId = registry.get(signedInAtom)?.teamId
  if (teamId === undefined || !validWidth(width) || registry.get(junoPanelWidthAtom) === width) return
  registry.set(changedWidthAtom(teamId), width)
  void runCommand(registry, prefsSet, { key: JUNO_PANEL_PREF, value: { width } })
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

/** A topic message to quote in the Juno panel's composer; `n` counts requests, so each is taken once. */
export interface JunoQuoteRequest {
  readonly n: number
  readonly topicId: string
  readonly selection: Selection
}

export const junoQuoteAtom = Atom.make<JunoQuoteRequest | undefined>(undefined).pipe(Atom.keepAlive)

let quoteRequests = 0

/** The panel clears the request once it has taken it, so a panel that opens later does not quote it again. */
export function quoteInJuno(registry: Registry, topicId: string, selection: Selection): void {
  registry.set(junoQuoteAtom, { n: ++quoteRequests, topicId, selection })
}

export function focusJunoComposer(registry: Registry, where: JunoFocusRequest['where']): void {
  registry.set(junoFocusAtom, { n: registry.get(junoFocusAtom).n + 1, where })
}

/**
 * A message a topic should show and flash once it is on screen: a Juno
 * source link or a notification opened it (SPEC 13.1, 14). `n` counts
 * requests across the app, so the same message asked twice flashes twice.
 * The topic clears the request once it has shown it, so a later open of
 * the topic does not jump back to it.
 */
export const messageFlashAtom = Atom.family((_topicId: string) => Atom.make<{ readonly ts: string; readonly n: number } | undefined>(undefined).pipe(Atom.keepAlive))

let flashRequests = 0

export function flashMessage(registry: Registry, topicId: string, ts: string): void {
  registry.set(messageFlashAtom(topicId), { ts, n: ++flashRequests })
}
