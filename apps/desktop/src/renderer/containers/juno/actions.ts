/**
 * Where Juno opens (SPEC 7 "Juno panel", 13.1; inventory 12, 12.1):
 *
 * - the Juno tab, a page like Home, one tab for the one chat;
 * - the Juno panel beside a topic tab, open or closed for every topic tab;
 * - Ask Juno in a person's or channel's menu, which opens the panel (or the
 *   tab when no topic tab is active) with an About chip.
 *
 * Each of these asks the composer it brings on screen for focus.
 */
import type { About } from '@juno/agent-contract'
import {
  activeTab,
  currentPlace,
  focusJunoComposer,
  junoAboutAtom,
  junoAgentOnAtom,
  junoPanelOpenAtom,
  registry,
  setJunoPanelOpen,
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
  if (!registry.get(junoAgentOnAtom)) return
  if (topicTabActive()) toggleJunoPanel()
  else openJunoTab()
}

/** Ask Juno in a person's or channel's menu (SPEC 7, plan v3 §19.3). */
export function askJunoAbout(about: Exclude<About, { _tag: 'topic' }>): void {
  registry.set(junoAboutAtom, about)
  if (topicTabActive()) openPanel()
  else openJunoTab()
}

/** The paused chip's Resume: the same switch as Settings › Juno's Pause. */
export function resumeJuno(): void {
  void junoPageActions(registry).settings({ _tag: 'paused', value: false })
}
