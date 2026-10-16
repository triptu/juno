/**
 * Where Juno opens (SPEC 7 "Juno panel", 13.1; inventory 12, 12.1):
 *
 * - the Juno tab, a page like Home, one tab for the one chat;
 * - the Juno panel beside a topic tab, open or closed for every topic tab;
 * - Ask Juno in a person's or channel's menu, which opens the panel (or the
 *   tab when no topic tab is active) with an About chip;
 * - Tell Juno in the why popover, which opens the panel the same way with
 *   the message quoted.
 *
 * Each of these asks the composer it brings on screen for focus.
 */
import type { About, Selection } from '@juno/agent-contract'
import {
  activeTab,
  currentPlace,
  focusJunoComposer,
  JUNO_TAB_ABOUT,
  junoAboutAtom,
  junoAvailableAtom,
  junoPanelOpenAtom,
  quoteInJuno,
  registry,
  setJunoPanelOpen,
  showInJunoChat,
  tabsAtom,
} from '@juno/state'
import { chatActions, junoPageActions } from '@juno/state/agent'
import { openJuno } from '../navigation'

export { openJunoPage } from '../navigation'

/** The chat's RPC-backed commands, one set for the app. */
export const junoCommands = chatActions(registry)

const topicTabActive = (): boolean => {
  const tab = activeTab(registry.get(tabsAtom))
  return tab !== undefined && currentPlace(tab).kind === 'topic'
}

/** The sidebar's Juno item, and ⌘J outside a topic tab. */
export function openJunoTab(options: { readonly newTab?: boolean } = {}): void {
  openJuno(options)
  focusJunoComposer(registry, 'tab')
}

let panelOpenedAt: number | undefined

/** When the panel was asked to open, once, for `juno.panel-open`. */
export function takePanelOpenStart(): number | undefined {
  const at = panelOpenedAt
  panelOpenedAt = undefined
  return at
}

function openPanel(): void {
  if (!registry.get(junoPanelOpenAtom)) panelOpenedAt = performance.now()
  setJunoPanelOpen(registry, true)
  focusJunoComposer(registry, 'panel')
}

/** The header's Juno button and ⌘J in a topic tab. */
export function toggleJunoPanel(): void {
  if (registry.get(junoPanelOpenAtom)) setJunoPanelOpen(registry, false)
  else openPanel()
}

export function closeJunoPanel(): void {
  setJunoPanelOpen(registry, false)
}

/** The panel's "Open in a tab": the Juno tab, and the panel closes. */
export function moveJunoToTab(): void {
  closeJunoPanel()
  openJunoTab()
}

/** View › Juno (⌘J): the panel in a topic tab, the Juno tab elsewhere. Nothing while the agent is off. */
export function runJunoShortcut(): void {
  if (!registry.get(junoAvailableAtom)) return
  if (topicTabActive()) toggleJunoPanel()
  else openJunoTab()
}

/** Ask Juno in a person's or channel's menu (SPEC 7, plan v3 §19.3). */
export function askJunoAbout(about: Exclude<About, { _tag: 'topic' }>): void {
  registry.set(junoAboutAtom(aboutKey()), about)
  if (topicTabActive()) openPanel()
  else openJunoTab()
}

/** Whose About chip Ask Juno sets: the active topic tab's panel, or the Juno tab's. */
function aboutKey(): string {
  const active = registry.get(tabsAtom).active
  return topicTabActive() && active !== undefined ? active : JUNO_TAB_ABOUT
}

/** The hours-start summary's notification (SPEC 14): the Juno tab, at the summary's message, which flashes. */
export function openJunoAt(messageId: string): void {
  showInJunoChat(registry, messageId)
  openJuno()
}

/** Tell Juno in the why popover (SPEC 14, inventory 15.4): the chat beside the topic, with the message quoted in its composer. */
export function tellJunoAbout(topicId: string, quote: Selection | undefined): void {
  registry.set(junoAboutAtom(aboutKey()), undefined)
  if (quote !== undefined) quoteInJuno(registry, topicId, quote)
  if (topicTabActive()) openPanel()
  else openJunoTab()
}

/** The paused chip's Resume: the same switch as Settings › Juno's Pause. */
export function resumeJuno(): void {
  void junoPageActions(registry).settings({ _tag: 'paused', value: false })
}
