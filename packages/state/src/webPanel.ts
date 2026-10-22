/**
 * The web panel beside a topic (SPEC 7): a web page from a link, drawn by
 * main in the Juno panel's place.
 *
 * - `webPanelAtom`: the tab the panel belongs to and the url it opened with.
 *   One panel per window, in memory only. It shows while its tab is active.
 * - `webPanelStateAtom`: the page as main reports it (url, title, icon,
 *   loading), or undefined before the first report. `followWebPanel` feeds it.
 * - `webPanelOnAtom`: Settings › General "Open links in Juno", a workspace
 *   preference, on by default. Off, every link opens in the browser, and
 *   turning it off closes the panel (`followWebPanel` watches it).
 * - `openWebPanel`: a link opens in the active tab's panel, or in the browser
 *   when the panel is off, cannot show the link or the window is too narrow.
 *
 * In a tab the side slot shows the web panel or the Juno panel, never both:
 * opening a link closes the Juno panel there, and `setJunoPanelOpen(true)`
 * closes the web panel.
 */
import { Schema } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import { JUNO_PANEL_WIDTH, WebPanelState, prefsGet, prefsSet, webPanelCanShow } from '@juno/contract'
import type { JunoBridge } from '@juno/contract/channels'
import { liveQuery, runCommand } from './atoms'
import type { Registry } from './client'
import { openExternal, sidebarLayoutAtom } from './shell'
import { setJunoPanelOpen } from './junoPanel'
import { activeTab, tabsAtom } from './tabs'

declare const window: { readonly juno: JunoBridge; readonly innerWidth: number }

export interface WebPanel {
  readonly tabId: string
  readonly url: string
  /** Counts opens, so opening the same link again loads it again. */
  readonly opened: number
}

export const webPanelAtom = Atom.make<WebPanel | undefined>(undefined).pipe(Atom.keepAlive)

const decodeState = Schema.decodeUnknownOption(WebPanelState)

export const webPanelStateAtom = Atom.make<WebPanelState | undefined>(undefined).pipe(Atom.keepAlive)

export const WEB_PANEL_PREF = 'webPanel'

const savedWebPanelOnAtom = liveQuery(prefsGet)({ key: WEB_PANEL_PREF })

export const webPanelOnAtom = Atom.make((get): boolean => {
  const saved = get(savedWebPanelOnAtom)
  return !(AsyncResult.isSuccess(saved) && saved.value === false)
})

export function setWebPanelOn(registry: Registry, on: boolean) {
  return runCommand(registry, prefsSet, { key: WEB_PANEL_PREF, value: on })
}

/**
 * Follows main's reports of the page into `webPanelStateAtom`, and closes the
 * panel when it is turned off. Holds `webPanelOnAtom` so `openWebPanel` reads
 * the saved value. Returns the unsubscribe.
 */
export function followWebPanel(registry: Registry): () => void {
  const stopState = window.juno.webPanel.onState((value) => {
    const state = decodeState(value)
    if (state._tag === 'Some' && registry.get(webPanelAtom) !== undefined) registry.set(webPanelStateAtom, state.value)
  })
  const stopOn = registry.subscribe(webPanelOnAtom, (on) => {
    if (!on) closeWebPanel(registry)
  }, { immediate: true })
  return () => {
    stopState()
    stopOn()
  }
}

/**
 * The panel at its narrowest beside a 360px topic, with the panel's two
 * insets. The default 1200px window has room; below this the page would hide
 * most of the topic, so the link opens in the browser.
 */
const MIN_ROOM = JUNO_PANEL_WIDTH.min + 360 + 2 * 8

function roomForPanel(registry: Registry): boolean {
  const sidebar = registry.get(sidebarLayoutAtom)
  return window.innerWidth - (sidebar.collapsed ? 0 : sidebar.width) >= MIN_ROOM
}

/** Whether this window can show `url` in Juno, regardless of the saved default. */
export function canOpenWebPanel(registry: Registry, url: string): boolean {
  return activeTab(registry.get(tabsAtom)) !== undefined && webPanelCanShow(url) && roomForPanel(registry)
}

/** Whether a plain click on this web link opens it in Juno. */
export function webPanelOpensInJuno(registry: Registry, url: string): boolean {
  return registry.get(webPanelOnAtom) && canOpenWebPanel(registry, url)
}

function showWebPanel(registry: Registry, url: string): void {
  const tab = activeTab(registry.get(tabsAtom))
  if (tab === undefined) return
  setJunoPanelOpen(registry, false)
  registry.set(webPanelStateAtom, undefined)
  registry.set(webPanelAtom, { tabId: tab.id, url, opened: (registry.get(webPanelAtom)?.opened ?? 0) + 1 })
}

export function openWebPanel(registry: Registry, url: string): void {
  if (!webPanelOpensInJuno(registry, url)) {
    openExternal(url)
    return
  }
  showWebPanel(registry, url)
}

/** Opens in Juno even when the saved default is the browser; impossible links still use the browser. */
export function openWebPanelInJuno(registry: Registry, url: string): void {
  if (canOpenWebPanel(registry, url)) showWebPanel(registry, url)
  else openExternal(url)
}

export function closeWebPanel(registry: Registry): void {
  if (registry.get(webPanelAtom) === undefined) return
  registry.set(webPanelAtom, undefined)
  registry.set(webPanelStateAtom, undefined)
  window.juno.webPanel.close().catch(() => {})
}
