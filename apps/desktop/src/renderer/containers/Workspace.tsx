import { Activity, Suspense, useEffect } from 'react'
import {
  activeTab,
  closeWebPanel,
  currentPlace,
  followWebPanel,
  fullScreenAtom,
  junoAvailableAtom,
  junoPanelOpenAtom,
  junoPanelWidthAtom,
  mountedTabs,
  onMenuCommand,
  registry,
  setJunoPanelWidth,
  sidebarLayoutAtom,
  startTabExpiry,
  startVisitLog,
  tabsAtom,
  tabStripAtom,
  tabTopic,
  type Tab,
  type Tabs,
  type TabSummary,
  webPanelAtom,
} from '@juno/state'
import { JUNO_PANEL_WIDTH } from '@juno/contract'
import { useAtomValue } from '@juno/state/react'
import { holdKeys, loadMessageTools, Workspace as WorkspaceView, type ActivateEvent, type WorkspaceTab } from '@juno/views'
import { chunk, usePreloaded } from './chunks'
import { runJunoShortcut } from './juno/actions'
import { JunoPanel, loadJuno } from './juno/lazy'
import { useNotificationBridge, WhyLayer } from './notificationBridge'
import { closeTabById, loadAllTopicsPage, moveTabTo, openNewTab, runMenuCommand, showTabMenu, stepTabHistory, switchToTab } from './navigation'
import { runUndoCommand } from './topicActions'
import { focusPage, forcePageFocus, pageComposer, takeForcedPageFocus, takeTypedAhead } from './pageFocus'
import { loadSettingsTab, tabKindOf } from './tabKinds'
import { loadChannelMenu } from './placeMenus'
import { TitlebarNav } from './TitlebarNav'

// The web panel warms on idle, outside the startup bundle.
const webPanelChunk = chunk(() => import('./WebPanel'))
const WebPanel = webPanelChunk.component((module) => module.WebPanel)

const tabs = new WeakMap<TabSummary, WorkspaceTab>()

/** A tab as the strip draws it, as its kind's entry says. */
function stripTab(summary: TabSummary): WorkspaceTab {
  const held = tabs.get(summary)
  if (held !== undefined) return held
  const { detail, place } = summary
  const tab: WorkspaceTab = { id: summary.id, pinned: summary.pinned, ...tabKindOf(place).strip(place, detail) }
  tabs.set(summary, tab)
  return tab
}

/** What a tab shows: its place's page, keyed by the place, so a new place in the tab mounts afresh. */
function Page({ tab }: { readonly tab: Tab }) {
  const place = currentPlace(tab)
  return tabKindOf(place).page(place, tab.id)
}

/** The topic the active tab shows, for the Juno panel beside it. */
const activeTopicOf = (state: Tabs): string | undefined => {
  const tab = activeTab(state)
  return tab === undefined ? undefined : tabTopic(tab)
}

function selectTab(id: string, event: ActivateEvent): void {
  if (event.source === 'pointer') forcePageFocus(id)
  if (registry.get(tabsAtom).active === id) restoreFocus(id)
  else switchToTab(id)
}

function tabMenu(id: string): void {
  void showTabMenu(id)
}

function resizePanel(width: number): void {
  setJunoPanelWidth(registry, width)
}

function resetPanelWidth(): void {
  setJunoPanelWidth(registry, JUNO_PANEL_WIDTH.default)
}

/**
 * The element that last had focus in each tab, outside the tab strip: its
 * page or its Juno panel. Each tab keeps its own composer focus (SPEC 6).
 * Weak, so a closed or put away tab's page is not held.
 */
const lastFocus = new Map<string, WeakRef<HTMLElement>>()

function onFocusIn(event: FocusEvent): void {
  const target = event.target
  if (!(target instanceof HTMLElement) || target.closest('section[aria-label="Workspace"]') === null || target.closest('[role="tablist"]') !== null) return
  const active = registry.get(tabsAtom).active
  if (active !== undefined) lastFocus.set(active, new WeakRef(target))
}

/**
 * A tab that shows gets back the focus it had, or else its composer. A
 * press on its tab, or an open of a topic it shows, always gives the page
 * focus, as Safari does; a keyboard switch does when it left focus nowhere
 * (⌃Tab while focus was in the page that hid). Focus on a tab in the strip,
 * moved there by the keyboard, stays.
 */
function restoreFocus(tabId: string): void {
  if (takeTypedAhead()) return
  const force = takeForcedPageFocus(tabId)
  const focused = document.activeElement
  if (!force && focused instanceof HTMLElement && focused !== document.body && focused.checkVisibility()) return
  const kept = lastFocus.get(tabId)?.deref()
  const element = kept !== undefined && kept.isConnected && kept.checkVisibility() ? kept : pageComposer()
  if (element === undefined) return
  if (force) focusPage(element)
  else element.focus({ preventScroll: true })
}


/** The mouse's back and forward buttons. */
function onMouseUp(event: MouseEvent): void {
  if (event.button === 3) stepTabHistory(-1)
  else if (event.button === 4) stepTabHistory(1)
}

/**
 * ⌘N and ⌘T reach the page before main's menu runs them and sends the
 * command back. Keys typed in that time are held from the shortcut's own
 * key, so they reach Home's field or search, not the field that had focus.
 */
function holdKeysAfterNewShortcut(event: KeyboardEvent): void {
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return
  const key = event.key.toLowerCase()
  if (key === 'n' || key === 't') holdKeys()
}

/** The workspace's app-wide wiring: menu commands, notifications, idle preloads, per-tab focus and the mouse's back and forward buttons. */
function useWorkspaceEffects(active: string | undefined): void {
  useNotificationBridge()
  useEffect(() => onMenuCommand(runMenuCommand), [])
  useEffect(() => {
    window.addEventListener('keydown', holdKeysAfterNewShortcut, true)
    return () => window.removeEventListener('keydown', holdKeysAfterNewShortcut, true)
  }, [])
  useEffect(() => onMenuCommand(runUndoCommand), [])
  useEffect(() => followWebPanel(registry), [])
  useEffect(() => onMenuCommand((command) => command === 'juno.toggle' && runJunoShortcut()), [])
  // "Pick up where you left off" on Home: the topic that stayed on screen for a minute.
  useEffect(() => startVisitLog(registry), [])
  // Tabs not viewed in the chosen time close, at launch and hourly (SPEC 6).
  useEffect(() => startTabExpiry(registry), [])
  useEffect(() => {
    const idle = requestIdleCallback(
      () => {
        void loadMessageTools()
        void loadChannelMenu()
        void loadSettingsTab()
        void loadAllTopicsPage()
        if (registry.get(junoAvailableAtom)) void loadJuno()
      },
      { timeout: 5_000 },
    )
    return () => cancelIdleCallback(idle)
  }, [])
  useEffect(() => {
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])
  // After the pages' own effects, so a composer takes another tab's draft before it has focus again.
  useEffect(() => {
    if (active !== undefined) restoreFocus(active)
  }, [active])
  useEffect(() => {
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])
}

/**
 * The tab strip and the open tabs. The active tab and the 4 most recently
 * active stay mounted in `<Activity>` (performance 4.3), so a switch is a
 * display toggle; older tabs unmount and come back at their scroll
 * snapshot. A tab's topic is keyed by its id, so Back and Forward mount the
 * topic they bring back. There is always a tab (`ensureTab`); until the saved tabs have
 * been read the page is blank. While the sidebar is hidden the strip
 * starts with its controls.
 */
export function Workspace() {
  const state = useAtomValue(tabsAtom)
  const strip = useAtomValue(tabStripAtom)
  const sidebarHidden = useAtomValue(sidebarLayoutAtom, (layout) => layout.collapsed)
  const fullScreen = useAtomValue(fullScreenAtom)
  const mounted = mountedTabs(state)
  // The Juno panel shows beside a topic tab while it is open in that tab, and never on a page (SPEC 7).
  const agentOn = useAtomValue(junoAvailableAtom)
  const panelOpen = useAtomValue(junoPanelOpenAtom)
  const panelWidth = useAtomValue(junoPanelWidthAtom)
  const panelTopic = useAtomValue(tabsAtom, activeTopicOf)
  // The web panel takes the same slot, in the tab it was opened in (SPEC 7).
  const webPanel = useAtomValue(webPanelAtom)
  const webShown = webPanel !== undefined && webPanel.tabId === state.active
  usePreloaded(webPanelChunk, webShown)

  useWorkspaceEffects(state.active)
  // A closed tab takes its web panel with it.
  const webTabOpen = webPanel === undefined || state.tabs.some((tab) => tab.id === webPanel.tabId)
  useEffect(() => {
    if (!webTabOpen) closeWebPanel(registry)
  }, [webTabOpen])

  const pages = state.tabs.filter((tab) => mounted.has(tab.id))

  return (
    <>
    <WorkspaceView
      tabs={strip.map(stripTab)}
      {...(state.active === undefined ? {} : { activeId: state.active })}
      onSelectTab={selectTab}
      onCloseTab={closeTabById}
      onMoveTab={moveTabTo}
      onNewTab={openNewTab}
      onTabContextMenu={tabMenu}
      {...(sidebarHidden ? { leading: <TitlebarNav /> } : {})}
      fullScreen={fullScreen}
      nothingShown={state.active === undefined}
      empty={null}
      side={
        webShown ? (
          <Suspense fallback={null}>
            <WebPanel key={webPanel.opened} url={webPanel.url} />
          </Suspense>
        ) : agentOn && panelOpen && panelTopic !== undefined && state.active !== undefined ? (
          <Suspense fallback={null}>
            <JunoPanel tabId={state.active} topicId={panelTopic} />
          </Suspense>
        ) : undefined
      }
      sideKind={webShown ? 'web' : 'juno'}
      sideWidth={panelWidth}
      onSideResize={resizePanel}
      onSideResetWidth={resetPanelWidth}
    >
      {pages.length === 0
        ? undefined
        : pages.map((tab) => (
            <Activity key={tab.id} mode={tab.id === state.active ? 'visible' : 'hidden'}>
              <Page tab={tab} />
            </Activity>
          ))}
    </WorkspaceView>
    <WhyLayer />
    </>
  )
}
