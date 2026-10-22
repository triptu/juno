/**
 * Where Juno opens (SPEC 7 "Juno panel", 13.1; inventory 12, 12.1):
 *
 * - the Juno tab, a page like Home, one tab for the one chat;
 * - the Juno panel beside a topic tab, open or closed for every topic tab;
 * - Ask Juno in a person's or channel's menu, which opens the panel (or the
 *   tab when no topic tab is active) with an About chip;
 * - Tell Juno in the why popover, which opens the panel the same way with
 *   the message quoted.
 * - What Juno knows about {name}, in a DM's menu and the person menu, which
 *   opens that person's file on What Juno remembers.
 * - Ask Juno on text selected in a topic's messages (the selection toolbar,
 *   or ⌘J while there is one), which opens the panel with the selection.
 *
 * Each of these asks the composer it brings on screen for focus. Each
 * decides between the panel and the tab once a topic open asked for
 * before it has landed (`afterNavigation`).
 */
import { personFileMissing, MemoryPersonId, type About } from '@juno/agent-contract'
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
  showToast,
  tabsAtom,
  tabTopic,
  tickWelcome,
} from '@juno/state'
import { chatActions, hasPersonFile, junoPageActions, memoryPersonAtom } from '@juno/state/agent'
import { afterNavigation, openJuno, openJunoPage } from '../navigation'
import { clearTopicSelection, topicSelection } from './topicContext'

export { openJunoPage } from '../navigation'

const chat = chatActions(registry)

/** The chat's RPC-backed commands, one set for the app. A sent question is the welcome card's third hint (SPEC 4). */
export const junoCommands: typeof chat = {
  ...chat,
  send: (...args) => {
    tickWelcome(registry, 'juno')
    return chat.send(...args)
  },
}

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

/** Opens the Juno panel beside the active topic, with its composer focused. */
export function openPanel(): void {
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

/**
 * View › Juno (⌘J): the panel in a topic tab, the Juno tab elsewhere.
 * With text selected in the topic's messages it asks about the selection,
 * as the selection toolbar's Ask Juno does, and never closes the panel.
 * Nothing while the agent is off.
 */
export function runJunoShortcut(): void {
  if (!registry.get(junoAvailableAtom)) return
  if (askJunoAboutSelection()) return
  afterNavigation(() => {
    if (topicTabActive()) toggleJunoPanel()
    else openJunoTab()
  })
}

/**
 * Ask Juno on the selection (SPEC 7, Quoting): the panel beside the topic
 * opens if it is closed, with the selection as its chip and the composer
 * focused. The highlight clears, as after Quote. False when no text is
 * selected in the active topic's messages.
 */
export function askJunoAboutSelection(): boolean {
  const tab = activeTab(registry.get(tabsAtom))
  const topicId = tab === undefined ? undefined : tabTopic(tab)
  const selection = topicId === undefined ? undefined : topicSelection()
  if (topicId === undefined || selection === undefined || !registry.get(junoAvailableAtom)) return false
  clearTopicSelection()
  registry.set(junoAboutAtom(aboutKey()), undefined)
  quoteInJuno(registry, topicId, selection)
  openPanel()
  return true
}

/** Ask Juno in a person's or channel's menu (SPEC 7, plan v3 §19.3). */
export function askJunoAbout(about: Exclude<About, { _tag: 'topic' }>): void {
  afterNavigation(() => {
    registry.set(junoAboutAtom(aboutKey()), about)
    if (topicTabActive()) openPanel()
    else openJunoTab()
  })
}

/**
 * What Juno knows about {name} (SPEC 13.8): their file on What Juno
 * remembers, in place of the page, or a toast when Juno has none yet. When
 * the agent does not answer in time the page opens at People.
 */
export async function showWhatJunoKnows(person: { readonly id: string; readonly name: string }): Promise<void> {
  const known = await hasPersonFile(registry, person.id)
  if (known === false) return showToast(registry, { text: personFileMissing(person.name) })
  registry.set(memoryPersonAtom, known === true ? MemoryPersonId.make(person.id) : undefined)
  openJunoPage('remembers')
}

/** Whose About chip Ask Juno sets: the active topic tab's panel, or the Juno tab's. */
function aboutKey(): string {
  const active = registry.get(tabsAtom).active
  return topicTabActive() && active !== undefined ? active : JUNO_TAB_ABOUT
}

/** The paused chip's Resume: the same switch as Settings › Juno's Pause. */
export function resumeJuno(): void {
  void junoPageActions(registry).settings({ _tag: 'paused', value: false })
}
