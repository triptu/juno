import { startTransition, useEffect, useState } from 'react'
import {
  activeTab,
  connectionStateAtom,
  currentPlace,
  engineStatusAtom,
  fullScreenAtom,
  notificationStatusAtom,
  popupContextMenu,
  privacyAtom,
  privacySharingAtom,
  registry,
  setPresence,
  sidebarDotAtom,
  sidebarFilterAtom,
  sidebarListAtom,
  signedInAtom,
  sessionProfileAtom,
  syncNoticeAtom,
  syncProgressAtom,
  tabsAtom,
  viewPillsAtom,
  viewSheetAtom,
  type Tabs,
} from '@juno/state'
import { junoNavAtom } from '@juno/state/agent'
import { useAtom, useAtomValue } from '@juno/state/react'
import { hueFor, initials, Sidebar as SidebarView, UpdateReady, type AccountMenuAction, type ActivateEvent, type SidebarNavTarget } from '@juno/views'
import { chunk } from './chunks'
import { SyncNotice, useSyncNoticeReady } from './SyncNotice'
import { markFilterChange } from './filterMark'
import { openJunoTab } from './juno/actions'
import { openAllTopics, openHome, openSettings, warmHome } from './navigation'
import { openSearch } from './search/open'
import { setPrivacy } from './privacy'
import { readingOnly } from './readingOnly'
import { sidebarTop } from './sidebarTop'
import { TitlebarNav } from './TitlebarNav'
import { TopicList } from './TopicList'
import { restartToUpdate, useUpdateReady } from './updateState'
import { closeViewSheet, moveView, newView, selectKind, selectView, showViewPillMenu } from './viewActions'

// Popover content warms on idle; the sidebar chrome stays in the initial bundle.
const viewSheet = chunk(() => import('./ViewSheet'))
const loadViewSheet = viewSheet.load
const accountMenu = chunk(() => import('./AccountMenuContent'))
const loadAccountMenu = accountMenu.load
const ViewSheet = viewSheet.component((module) => module.ViewSheet)
const AccountMenu = accountMenu.component((module) => module.default)

function navigate(target: SidebarNavTarget, event: ActivateEvent): void {
  if (target === 'home') return openHome({ newTab: event.metaKey })
  if (target === 'all-topics') return openAllTopics({ newTab: event.metaKey })
  if (target === 'juno') return openJunoTab({ newTab: event.metaKey })
  if (target === 'search') return openSearch({ newTab: event.metaKey })
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
    case 'search':
      return 'search'
    default:
      return undefined
  }
}

/**
 * Reading only: no page buttons, no account, no huddle bar, the views
 * without their menu or reordering, and a note that the conversations are
 * samples.
 */
const READING = { pages: [], note: 'Demo · sample conversations' } as const

/** The Update ready pill's text: Settings › About, where the update's line has What's new. */
const openAbout = () => openSettings('about')

/**
 * Wires the sidebar chrome: the filters and scope (local UI state), the
 * filter dots (booleans from the counts live value, so a count that changes
 * without a dot changing re-renders nothing), the sync status card, and
 * the account menu, whose Notifications and Settings open Settings. The
 * list is a memoized child with no props, so a render here does not reach
 * the rows.
 */
export function Sidebar() {
  const reading = readingOnly()
  useEffect(() => {
    if (reading) return undefined
    const idle = requestIdleCallback(() => {
      void loadViewSheet()
      void loadAccountMenu()
    }, { timeout: 5_000 })
    return () => cancelIdleCallback(idle)
  }, [reading])
  const [filter, setFilter] = useAtom(sidebarFilterAtom)
  const views = useAtomValue(viewPillsAtom)
  const sheet = useAtomValue(viewSheetAtom)
  const channelsDot = useAtomValue(sidebarDotAtom('channels'))
  const dmsDot = useAtomValue(sidebarDotAtom('dms'))
  const fullScreen = useAtomValue(fullScreenAtom)
  const user = useAtomValue(signedInAtom)
  const profile = useAtomValue(sessionProfileAtom)
  const person = profile._tag === 'Success' ? profile.value : null
  const activeNav = useAtomValue(tabsAtom, activeNavOf)
  const junoUnread = useAtomValue(junoNavAtom, (nav) => nav.unread)
  const junoBusy = useAtomValue(junoNavAtom, (nav) => nav.busy)
  const [menuOpen, setMenuOpen] = useState(false)
  const status = useAtomValue(notificationStatusAtom)
  const privacy = useAtomValue(privacyAtom)
  const privacySharing = useAtomValue(privacySharingAtom)
  // Whether the list may still change: the engine is not live, or a sync cycle runs. Two booleans, so a status tick re-renders nothing.
  const connected = useAtomValue(connectionStateAtom, (state) => state === 'connected')
  const caughtUp = useAtomValue(engineStatusAtom, (engine) => engine._tag === 'Success' && engine.value.phase._tag === 'live' && !engine.value.syncing)
  // Whether the footer's status card shows; the card reads the progress itself, so a count tick re-renders only the card.
  const noticeShown = useAtomValue(syncNoticeAtom, (kind) => kind !== undefined)
  const progressShown = useAtomValue(syncProgressAtom, (progress) => progress !== undefined)
  const syncStatus = useSyncNoticeReady(noticeShown || progressShown) && (noticeShown || progressShown)
  // A downloaded update: a boolean, so a download's progress re-renders nothing.
  const updateReady = useUpdateReady()
  // The scope chip names the channel the list is narrowed to; its rows' refs carry it.
  const scopeChannel = useAtomValue(sidebarListAtom, (list) => (filter.scope === undefined ? undefined : list.refs.channels.get(filter.scope)))

  const name = person?.name ?? user?.userName ?? ''
  const account = { ...(person?.avatarUrl ? { avatarUrl: person.avatarUrl } : {}), name, initials: initials(name) || '?', hue: hueFor('', user?.userId ?? '') }

  // The setting drives the menu's toggle; the dot shows what Slack shows colleagues, away until Slack says.
  const presence = status._tag === 'Success' && status.value.presence !== null ? { active: status.value.presence === 'active', seen: status.value.seen === 'active', label: status.value.presenceLabel } : undefined
  const paused = status._tag === 'Success' ? status.value.paused : undefined
  const accountAction = (action: AccountMenuAction) => {
    setMenuOpen(false)
    if (action === 'notifications') return openSettings('notifications')
    if (action === 'settings') return openSettings()
    if (action === 'privacy') return setPrivacy(!privacy)
    void setPresence(registry, presence?.active === false ? 'active' : 'away')
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
  const full = {
    top: sidebarTop,
    account: { ...account, ...(presence === undefined ? {} : { presence: presence.seen ? ('active' as const) : ('away' as const) }), ...(paused === undefined ? {} : { paused }) },
    accountMenuOpen: menuOpen,
    onAccountMenu: setMenuOpen,
    accountMenu: (
      <AccountMenu
        {...account}
        workspace={user?.teamName ?? ''}
        {...(presence === undefined ? {} : { presence })}
        {...(paused === undefined ? {} : { paused })}
        privacy={privacy}
        onAction={accountAction}
      />
    ),
    onNewView: newView,
    newViewOpen: sheet?.mode === 'new',
    onViewMenu: (id: string) => void showViewPillMenu(id),
    onMoveView: moveView,
  }

  return (
    <SidebarView
      titlebarLeading={<TitlebarNav />}
      fullScreen={fullScreen}
      {...(reading ? READING : full)}
      filter={{ kind: filter.kind, unreadOnly: filter.unreadOnly, view: filter.view }}
      dots={dots}
      {...(filter.scope === undefined ? {} : { scope: { name: scopeChannel?.name ?? filter.scope, kind: scopeChannel?.kind ?? 'public' } })}
      {...(activeNav === undefined ? {} : { activeNav })}
      junoUnread={junoUnread}
      junoBusy={junoBusy}
      onNavigate={navigate}
      onNavigateMenu={(target) => void navigateMenu(target)}
      onNavigatePrefetch={(target) => {
        if (target === 'home') warmHome()
      }}
      onFilterKind={selectKind}
      views={views}
      onFilterView={selectView}
      {...(sheet === undefined ? {} : { viewSheet: <ViewSheet key={JSON.stringify(sheet)} sheet={sheet} /> })}
      onCloseViewSheet={closeViewSheet}
      onToggleUnread={toggleUnread}
      onClearScope={clearScope}
      {...(syncStatus ? { status: <SyncNotice /> } : {})}
      {...(updateReady ? { update: <UpdateReady onRestart={restartToUpdate} onOpen={openAbout} /> } : {})}
      privacy={privacy}
      privacySharing={privacySharing}
      onPrivacyOff={() => setPrivacy(false)}
      syncing={!connected || !caughtUp}
    >
      <TopicList pillRoom={updateReady} />
    </SidebarView>
  )
}
