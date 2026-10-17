/**
 * The web panel beside a topic (SPEC 7): a web page from a link, drawn by
 * main in the Juno panel's place.
 *
 * - `webPanelAtom`: the tab the panel belongs to and the url it opened with.
 *   One panel per window, in memory only. It shows while its tab is active.
 * - `webPanelStateAtom`: the page as main reports it (url, title, icon,
 *   loading), or undefined before the first report. `followWebPanel` feeds it.
 * - `openWebPanel`: a link opens in the active tab's panel, or in the browser
 *   when the panel cannot show it or the window is too narrow for it.
 *
 * In a tab the side slot shows the web panel or the Juno panel, never both:
 * opening a link closes the Juno panel there, and `setJunoPanelOpen(true)`
 * closes the web panel.
 */
import { Schema } from 'effect'
import * as Atom from 'effect/reactivity/Atom'
import { JUNO_PANEL_WIDTH, WebPanelState, webPanelCanShow } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'
import type { Registry } from './client'
import { openExternal, sidebarLayoutAtom } from './shell'
import { setJunoPanelOpen } from './junoPanel'
import { activeTab, tabsAtom } from './tabs'

declare const window: { readonly juno: JunoBridge; readonly innerWidth: number }

export interface WebPanel {
  readonly tabId: string
  readonly url: string
}

export const webPanelAtom = Atom.make<WebPanel | undefined>(undefined).pipe(Atom.keepAlive)

const decodeState = Schema.decodeUnknownOption(WebPanelState)

export const webPanelStateAtom = Atom.make<WebPanelState | undefined>(undefined).pipe(Atom.keepAlive)

/** Follows main's reports of the page into `webPanelStateAtom`. Returns the unsubscribe. */
export function followWebPanel(registry: Registry): () => void {
  return window.juno.webPanel.onState((value) => {
    const state = decodeState(value)
    if (state._tag === 'Some' && registry.get(webPanelAtom) !== undefined) registry.set(webPanelStateAtom, state.value)
  })
}

/** The panel at its narrowest, the topic at its narrowest (--juno-panel-topic-min) and the panel's two insets: under this the panel would cover the topic. */
const MIN_ROOM = JUNO_PANEL_WIDTH.min + 480 + 2 * 8

function roomForPanel(registry: Registry): boolean {
  const sidebar = registry.get(sidebarLayoutAtom)
  return window.innerWidth - (sidebar.collapsed ? 0 : sidebar.width) >= MIN_ROOM
}

export function openWebPanel(registry: Registry, url: string): void {
  const tab = activeTab(registry.get(tabsAtom))
  if (tab === undefined || !webPanelCanShow(url) || !roomForPanel(registry)) {
    openExternal(url)
    return
  }
  setJunoPanelOpen(registry, false)
  registry.set(webPanelStateAtom, undefined)
  registry.set(webPanelAtom, { tabId: tab.id, url })
}

export function closeWebPanel(registry: Registry): void {
  if (registry.get(webPanelAtom) === undefined) return
  registry.set(webPanelAtom, undefined)
  registry.set(webPanelStateAtom, undefined)
  window.juno.webPanel.close().catch(() => {})
}
