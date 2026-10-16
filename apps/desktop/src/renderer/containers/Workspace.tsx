import { Activity, Suspense, useEffect } from 'react'
import { chatCopy } from '@juno/agent-contract'
import type { TopicDetail } from '@juno/contract'
import {
  activeTab,
  currentPlace,
  junoAvailableAtom,
  junoPanelOpenAtom,
  junoPanelWidthAtom,
  mountedTabs,
  newTabPageAtom,
  onMenuCommand,
  registry,
  setJunoPanelWidth,
  sidebarLayoutAtom,
  startVisitLog,
  tabsAtom,
  tabStripAtom,
  tabTopic,
  type Tab,
  type Tabs,
  type TabSummary,
} from '@juno/state'
import { JUNO_PANEL_WIDTH } from '@juno/contract'
import { useAtomValue } from '@juno/state/react'
import { TopicArt, Workspace as WorkspaceView, type ActivateEvent, type WorkspaceTab, type WorkspaceTabIcon } from '@juno/views'
import { chunk } from './chunks'
import { HomePage } from './Home'
import { runJunoShortcut } from './juno/actions'
import { JunoPageTab, JunoPanel, JunoTab, loadJuno } from './juno/lazy'
import { useNotificationBridge, WhyLayer } from './notificationBridge'
import { AllTopicsPage, closeTabById, loadAllTopicsPage, openNewTab, runMenuCommand, showTabMenu, stepTabHistory, switchToTab } from './navigation'
import { NewChatTab } from './NewChat'
import { runUndoCommand } from './topicActions'
import { TitlebarNav } from './TitlebarNav'
import { hasArt, TopicTab } from './TopicView'

// Settings warms on idle after the first paint, outside the startup bundle.
const settings = chunk(() => import('./Settings'))
const SettingsTab = settings.component((module) => module.SettingsTab)

const kindIcons: Record<TopicDetail['channel']['kind'], WorkspaceTabIcon> = {
  public: 'hash',
  private: 'lock',
  im: 'user',
  mpim: 'users',
}

const tabs = new WeakMap<TabSummary, WorkspaceTab>()

/** A tab as the strip draws it: the topic title, or the channel name for Main, with the topic's art in the icon slot. */
function stripTab(summary: TabSummary): WorkspaceTab {
  const held = tabs.get(summary)
  if (held !== undefined) return held
  const { detail, place } = summary
  const base = { id: summary.id, pinned: summary.pinned }
  const tab: WorkspaceTab =
    place.kind === 'newChat'
      ? { ...base, title: summary.chatTitle ?? 'New chat', icon: 'new-chat' }
      : place.kind === 'home'
        ? { ...base, title: 'Home', icon: 'home' }
        : place.kind === 'allTopics'
          ? { ...base, title: 'All topics', icon: 'all-topics' }
          : place.kind === 'settings'
            ? { ...base, title: 'Settings', icon: 'settings' }
            : place.kind === 'juno'
              ? { ...base, title: 'Juno', icon: 'juno' }
              : place.kind === 'junoPage'
                ? { ...base, title: chatCopy.pageTitles[place.page], icon: 'juno' }
                : {
          ...base,
          title: detail == null ? '' : detail.kind === 'main' ? detail.channel.name : detail.title,
          icon: detail == null ? 'hash' : kindIcons[detail.channel.kind],
          unread: detail != null && detail.unreadCount > 0,
          ...(detail != null && hasArt(detail) ? { art: <TopicArt topicId={detail.id} recipe={detail.art} size={16} /> } : {}),
        }
  tabs.set(summary, tab)
  return tab
}

/** What a tab shows. A topic is keyed by its id, so a new place in the tab mounts afresh. */
function Page({ tab }: { readonly tab: Tab }) {
  const place = currentPlace(tab)
  switch (place.kind) {
    case 'topic':
      return <TopicTab key={place.viewId ?? place.topicId} tabId={tab.id} id={place.viewId ?? place.topicId} />
    case 'newChat':
      return <NewChatTab key="new-chat" tabId={tab.id} />
    case 'home':
      return <HomePage key="home" />
    case 'juno':
      return (
        <Suspense key="juno" fallback={null}>
          <JunoTab tabId={tab.id} />
        </Suspense>
      )
    case 'junoPage':
      return (
        <Suspense key={place.page} fallback={null}>
          <JunoPageTab page={place.page} />
        </Suspense>
      )
    case 'settings':
      return (
        <Suspense key="settings" fallback={null}>
          <SettingsTab section={place.section} />
        </Suspense>
      )
    case 'allTopics':
      return (
        <Suspense key="all-topics" fallback={null}>
          <AllTopicsPage />
        </Suspense>
      )
  }
}

/** The topic the active tab shows, for the Juno panel beside it. */
const activeTopicOf = (state: Tabs): string | undefined => {
  const tab = activeTab(state)
  return tab === undefined ? undefined : tabTopic(tab)
}

function selectTab(id: string, _event: ActivateEvent): void {
  switchToTab(id)
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
 * A tab that shows again gets back the focus it had, when the switch left
 * focus nowhere: a shortcut such as ⌃Tab, while focus was in the page that
 * hid. Focus the switch put somewhere, as on a tab in the strip, stays.
 */
function restoreFocus(tabId: string): void {
  const element = lastFocus.get(tabId)?.deref()
  if (element === undefined || !element.isConnected || !element.checkVisibility()) return
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused !== document.body && focused.checkVisibility()) return
  element.focus({ preventScroll: true })
}

/** The mouse's back and forward buttons. */
function onMouseUp(event: MouseEvent): void {
  if (event.button === 3) stepTabHistory(-1)
  else if (event.button === 4) stepTabHistory(1)
}

/**
 * The tab strip and the open tabs. The active tab and the 4 most recently
 * active stay mounted in `<Activity>` (performance 4.3), so a switch is a
 * display toggle; older tabs unmount and come back at their scroll
 * snapshot. A tab's topic is keyed by its id, so Back and Forward mount the
 * topic they bring back, and a New chat that sends becomes its topic in one
 * commit. There is always a tab (`ensureTab`); until the saved tabs have
 * been read the page is blank. While the sidebar is hidden the strip
 * starts with its controls.
 */
export function Workspace() {
  const state = useAtomValue(tabsAtom)
  const strip = useAtomValue(tabStripAtom)
  const sidebarHidden = useAtomValue(sidebarLayoutAtom, (layout) => layout.collapsed)
  const mounted = mountedTabs(state)
  // The Juno panel shows beside a topic tab while it is open in that tab, and never on a page (SPEC 7).
  const agentOn = useAtomValue(junoAvailableAtom)
  const panelOpen = useAtomValue(junoPanelOpenAtom)
  const panelWidth = useAtomValue(junoPanelWidthAtom)
  const panelTopic = useAtomValue(tabsAtom, activeTopicOf)
  const newTabPage = useAtomValue(newTabPageAtom)

  useNotificationBridge()
  useEffect(() => onMenuCommand(runMenuCommand), [])
  useEffect(() => onMenuCommand(runUndoCommand), [])
  useEffect(() => onMenuCommand((command) => command === 'juno.toggle' && runJunoShortcut()), [])
  // "Pick up where you left off" on Home: the topic that stayed on screen for a minute.
  useEffect(() => startVisitLog(registry), [])
  useEffect(() => {
    const idle = requestIdleCallback(
      () => {
        void settings.load()
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
    if (state.active !== undefined) restoreFocus(state.active)
  }, [state.active])
  useEffect(() => {
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

  const pages = state.tabs.filter((tab) => mounted.has(tab.id))

  return (
    <>
    <WorkspaceView
      tabs={strip.map(stripTab)}
      {...(state.active === undefined ? {} : { activeId: state.active })}
      onSelectTab={selectTab}
      onCloseTab={closeTabById}
      onNewTab={openNewTab}
      onTabContextMenu={tabMenu}
      {...(sidebarHidden ? { leading: <TitlebarNav /> } : {})}
      nothingShown={state.active === undefined}
      empty={null}
      newTabLabel={newTabPage === 'home' ? 'New tab' : 'New chat'}
      side={
        agentOn && panelOpen && panelTopic !== undefined && state.active !== undefined ? (
          <Suspense fallback={null}>
            <JunoPanel tabId={state.active} topicId={panelTopic} />
          </Suspense>
        ) : undefined
      }
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
