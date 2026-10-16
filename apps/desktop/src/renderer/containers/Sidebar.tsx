import { lazy, Suspense, startTransition, useEffect, useState } from 'react'
import {
  activeTab,
  connectionStateAtom,
  currentPlace,
  engineStatusAtom,
  notificationStatusAtom,
  popupContextMenu,
  privacyAtom,
  registry,
  setPresence,
  sidebarDotAtom,
  sidebarFilterAtom,
  sidebarListAtom,
  signedInAtom,
  tabsAtom,
  viewPillsAtom,
  viewSheetAtom,
  type Tabs,
} from '@juno/state'
import { junoNavAtom } from '@juno/state/agent'
import { useAtom, useAtomValue } from '@juno/state/react'
import { hueFor, initials, Sidebar as SidebarView, type AccountMenuAction, type ActivateEvent, type SidebarNavTarget } from '@juno/views'
import { SyncNotice } from './EngineStatus'
import { markFilterChange } from './filterMark'
import { openJunoTab } from './juno/actions'
import { openAllTopics, openHome, openNewChat, openSettings } from './navigation'
import { openPalette } from './paletteActions'
import { setPrivacy } from './privacy'
import { TitlebarNav } from './TitlebarNav'
import { TopicList } from './TopicList'
import { closeViewSheet, moveView, newView, selectKind, selectView, showViewPillMenu } from './viewActions'

// Popover content warms on idle; the sidebar chrome stays in the initial bundle.
const loadViewSheet = () => import('./ViewSheet').then((chunk) => ({ default: chunk.ViewSheet }))
const loadAccountMenu = () => import('./AccountMenuContent')
const ViewSheet = lazy(loadViewSheet)
const AccountMenu = lazy(loadAccountMenu)

function navigate(target: SidebarNavTarget, event: ActivateEvent): void {
  if (target === 'home') return openHome({ newTab: event.metaKey })
  if (target === 'all-topics') return openAllTopics({ newTab: event.metaKey })
  if (target === 'juno') return openJunoTab({ newTab: event.metaKey })
}

/** A page item's menu: Open in new tab, as ⌘-click does. */
async function navigateMenu(target: SidebarNavTarget): Promise<void> {
  const chosen = await popupContextMenu([{ id: 'open-new-tab', label: 'Open in new tab' }])
  if (chosen === 'open-new-tab') navigate(target, { metaKey: true, shiftKey: false, altKey: false, source: 'pointer' })
}

/** The nav item of the active tab's page. */
function activeNavOf(tabs: Tabs): SidebarNavTarget | undefined {
  const tab = activeTab(tabs)
  if (tab === undefined) return undefined
  const place = currentPlace(tab)
  switch (place.kind) {
    case 'home':
      return 'home'
    case 'allTopics':
      return 'all-topics'
    case 'juno':
    case 'junoPage':
      return 'juno'
    default:
      return undefined
  }
}

/**
 * Wires the sidebar chrome: the filters and scope (local UI state), the
 * filter dots (booleans from the counts live value, so a count that changes
 * without a dot changing re-renders nothing), the sync status line, and
 * the account menu, whose Notifications and Settings open Settings. The
 * list is a memoized child with no props, so a render here does not reach
 * the rows.
 */
export function Sidebar() {
  useEffect(() => {
    const idle = requestIdleCallback(() => {
      void loadViewSheet()
      void loadAccountMenu()
    }, { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [])
  const [filter, setFilter] = useAtom(sidebarFilterAtom)
  const views = useAtomValue(viewPillsAtom)
  const sheet = useAtomValue(viewSheetAtom)
  const channelsDot = useAtomValue(sidebarDotAtom('channels'))
  const dmsDot = useAtomValue(sidebarDotAtom('dms'))
  const user = useAtomValue(signedInAtom)
  const activeNav = useAtomValue(tabsAtom, activeNavOf)
  const junoUnread = useAtomValue(junoNavAtom, (nav) => nav.unread)
  const junoBusy = useAtomValue(junoNavAtom, (nav) => nav.busy)
  const [menuOpen, setMenuOpen] = useState(false)
  const status = useAtomValue(notificationStatusAtom)
  const privacy = useAtomValue(privacyAtom)
  // Whether the list may still change: the engine is not live, or a sync cycle runs. Two booleans, so a status tick re-renders nothing.
  const connected = useAtomValue(connectionStateAtom, (state) => state === 'connected')
  const caughtUp = useAtomValue(engineStatusAtom, (engine) => engine._tag === 'Success' && engine.value.phase._tag === 'live' && !engine.value.syncing)
  // The scope chip names the channel the list is narrowed to; its rows' refs carry it.
  const scopeChannel = useAtomValue(sidebarListAtom, (list) => (filter.scope === undefined ? undefined : list.refs.channels.get(filter.scope)))

  const name = user?.userName ?? ''
  const account = { name, initials: initials(name) || '?', hue: hueFor('', user?.userId ?? '') }

  const presence = status._tag === 'Success' && status.value.presence !== null ? { active: status.value.presence === 'active', label: status.value.presenceLabel } : undefined
  const paused = status._tag === 'Success' ? status.value.paused : undefined
  const accountAction = (action: AccountMenuAction) => {
    setMenuOpen(false)
    if (action === 'notifications') return openSettings('notifications')
    if (action === 'settings') return openSettings()
    if (action === 'privacy') return setPrivacy(!privacy)
    setPresence(registry, presence?.active === false ? 'active' : 'away')
  }

  const toggleUnread = () => {
    markFilterChange()
    startTransition(() => setFilter({ ...filter, unreadOnly: !filter.unreadOnly }))
  }
  const clearScope = () => {
    markFilterChange()
    const { scope: _scope, ...rest } = filter
    startTransition(() => setFilter(rest))
  }

  const dots = { channels: channelsDot, dms: dmsDot }

  return (
    <SidebarView
      titlebarLeading={<TitlebarNav />}
      account={account}
      filter={{ kind: filter.kind, unreadOnly: filter.unreadOnly, view: filter.view }}
      dots={dots}
      {...(filter.scope === undefined ? {} : { scope: { name: scopeChannel?.name ?? filter.scope, kind: scopeChannel?.kind ?? 'public' } })}
      accountMenuOpen={menuOpen}
      onAccountMenu={setMenuOpen}
      accountMenu={
        <Suspense fallback={null}>
          <AccountMenu
            {...account}
            workspace={user?.teamName ?? ''}
            {...(presence === undefined ? {} : { presence })}
            {...(paused === undefined ? {} : { paused })}
            privacy={privacy}
            onAction={accountAction}
          />
        </Suspense>
      }
      onSearch={openPalette}
      {...(activeNav === undefined ? {} : { activeNav })}
      junoUnread={junoUnread}
      junoBusy={junoBusy}
      onNewChat={openNewChat}
      onNavigate={navigate}
      onNavigateMenu={(target) => void navigateMenu(target)}
      onFilterKind={selectKind}
      views={views}
      onFilterView={selectView}
      onNewView={newView}
      onViewMenu={(id) => void showViewPillMenu(id)}
      onMoveView={moveView}
      {...(sheet === undefined ? {} : { viewSheet: <Suspense fallback={null}><ViewSheet key={JSON.stringify(sheet)} sheet={sheet} /></Suspense> })}
      onCloseViewSheet={closeViewSheet}
      onToggleUnread={toggleUnread}
      onClearScope={clearScope}
      status={<SyncNotice />}
      privacy={privacy}
      onPrivacyOff={() => setPrivacy(false)}
      syncing={!connected || !caughtUp}
    >
      <TopicList />
    </SidebarView>
  )
}
