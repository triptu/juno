import { startTransition, useState } from 'react'
import {
  activeTab,
  currentPlace,
  notificationStatusAtom,
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
import { AccountMenu, hueFor, initials, Sidebar as SidebarView, type AccountMenuAction, type ActivateEvent, type SidebarNavTarget } from '@juno/views'
import { AppInfo } from './AppInfo'
import { EngineStatus, SyncNotice } from './EngineStatus'
import { markFilterChange } from './filterMark'
import { openJunoTab } from './juno/actions'
import { openAllTopics, openHome, openNewTab, openNotifications, openPreferences } from './navigation'
import { Session } from './Session'
import { TitlebarNav } from './TitlebarNav'
import { TopicList } from './TopicList'
import { closeViewSheet, moveView, newView, selectKind, selectView, showViewPillMenu } from './viewActions'
import { ViewSheet } from './ViewSheet'

function navigate(target: SidebarNavTarget, event: ActivateEvent): void {
  if (target === 'home') return openHome({ newTab: event.metaKey })
  if (target === 'all-topics') return openAllTopics({ newTab: event.metaKey })
  if (target === 'juno') return openJunoTab({ newTab: event.metaKey })
}

/** The nav item of the active tab's page. Home also reads as selected with no tab open. */
function activeNavOf(tabs: Tabs): SidebarNavTarget | undefined {
  const tab = activeTab(tabs)
  if (tab === undefined) return 'home'
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
 * the account menu, which holds the appearance settings
 * and the M1 diagnostics until Preferences exists. The list is a memoized
 * child with no props, so a render here does not reach the rows.
 */
export function Sidebar() {
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
  // The scope chip names the channel the list is narrowed to; its rows' refs carry it.
  const scopeChannel = useAtomValue(sidebarListAtom, (list) => (filter.scope === undefined ? undefined : list.refs.channels.get(filter.scope)))

  const name = user?.userName ?? ''
  const account = { name, initials: initials(name) || '?', hue: hueFor('', user?.userId ?? '') }

  const presence = status._tag === 'Success' && status.value.presence !== null ? { active: status.value.presence === 'active', label: status.value.presenceLabel } : undefined
  const paused = status._tag === 'Success' ? status.value.paused : undefined
  const accountAction = (action: AccountMenuAction) => {
    setMenuOpen(false)
    if (action === 'notifications') return openNotifications()
    if (action === 'preferences') return openPreferences()
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
        <AccountMenu
          {...account}
          workspace={user?.teamName ?? ''}
          {...(presence === undefined ? {} : { presence })}
          {...(paused === undefined ? {} : { paused })}
          onAction={accountAction}
          sections={[
            { title: 'Session', content: <Session /> },
            {
              title: 'Diagnostics',
              content: (
                <>
                  <AppInfo />
                  <EngineStatus />
                </>
              ),
            },
          ]}
        />
      }
      onSearch={() => {
        // TODO(M9): open the ⌘K palette.
      }}
      {...(activeNav === undefined ? {} : { activeNav })}
      junoUnread={junoUnread}
      junoBusy={junoBusy}
      onNewChat={openNewTab}
      onNavigate={navigate}
      onFilterKind={selectKind}
      views={views}
      onFilterView={selectView}
      onNewView={newView}
      onViewMenu={(id) => void showViewPillMenu(id)}
      onMoveView={moveView}
      {...(sheet === undefined ? {} : { viewSheet: <ViewSheet key={JSON.stringify(sheet)} sheet={sheet} /> })}
      onCloseViewSheet={closeViewSheet}
      onToggleUnread={toggleUnread}
      onClearScope={clearScope}
      status={<SyncNotice />}
    >
      <TopicList />
    </SidebarView>
  )
}
