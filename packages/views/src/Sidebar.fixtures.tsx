import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { AccountMenu } from './AccountMenu'
import { AppearanceSettings } from './AppearanceSettings'
import { EngineNotice } from './EngineStatusView'
import { hostileIds, newThreadsById, NOW, pinnedIds, recentIds, rows, rowsById } from './fixtures/topics'
import { Sidebar, type SidebarProps } from './Sidebar'
import { relativeTime } from './time'
import { TitlebarNav } from './TitlebarNav'
import { TopicList, type TopicListProps } from './TopicList'
import { TopicRow } from './TopicRow'

const noop = () => {}

const account = { name: 'Tushar', initials: 'T', hue: 'cyan' } as const

const chrome: Omit<SidebarProps, 'children'> = {
  titlebarLeading: <TitlebarNav sidebarHidden={false} canGoBack canGoForward={false} onToggleSidebar={noop} onBack={noop} onForward={noop} />,
  account,
  filter: { kind: 'all', unreadOnly: false },
  dots: { channels: true, dms: true },
  accountMenuOpen: false,
  onAccountMenu: noop,
  onSearch: noop,
  onNewChat: noop,
  onNavigate: noop,
  onFilterKind: noop,
  onToggleUnread: noop,
  onClearScope: noop,
}

const renderRow = (id: string, selected?: string) => {
  const row = rowsById.get(id)
  if (row === undefined) return null
  return (
    <TopicRow
      key={id}
      row={row}
      time={relativeTime(row.lastActivityAt, NOW)}
      selected={id === selected}
      tabbable={id === (selected ?? pinnedIds[0])}
      newThreads={newThreadsById.get(id)}
      onOpen={noop}
      onResolve={noop}
    />
  )
}

const list = (props: Partial<TopicListProps> & { readonly selected?: string } = {}) => {
  const { selected, ...rest } = props
  return (
    <TopicList
      sections={[
        { id: 'pinned', ids: pinnedIds },
        { id: 'recent', ids: recentIds },
      ]}
      renderRow={(id) => renderRow(id, selected)}
      enterEmpty={false}
      {...rest}
    />
  )
}

const full = (overrides: Partial<SidebarProps> = {}, listProps: Partial<TopicListProps> & { readonly selected?: string } = {}) => (
  <Sidebar {...chrome} {...overrides}>
    {list(listProps)}
  </Sidebar>
)

const frame: FixtureFrame = { width: 384, height: 720, padded: false, surface: 'subtle' }

export default defineFixtures(
  Sidebar,
  {
    List: {
      default: scene(() => full({}, { selected: rows.postgres.id })),
      'no-pins': scene(() => full({}, { sections: [{ id: 'recent', ids: recentIds }] })),
      'window-full': scene(() => full({}, { truncated: true })),
      'dms-only': scene(() => full({ filter: { kind: 'dms', unreadOnly: false }, dots: { channels: true, dms: false } }, { sections: [{ id: 'pinned', ids: pinnedIds }, { id: 'recent', ids: [rows.packet.id, rows.lunch.id] }] })),
      'unread-only': scene(() =>
        full({ filter: { kind: 'all', unreadOnly: true } }, { sections: [{ id: 'pinned', ids: [rows.offsite.id] }, { id: 'recent', ids: [rows.alertsMain.id, rows.hiring.id, rows.roadmap.id, rows.pricing.id, rows.flags.id] }] }),
      ),
    },
    Content: {
      // Right-to-left, emoji names, a long private channel, a lower-bound count, and the resolved and unsubscribed rows.
      hostile: scene(() => full({}, { sections: [{ id: 'recent', ids: hostileIds }] })),
    },
    Empty: {
      'caught-up': scene(() => full({ filter: { kind: 'all', unreadOnly: true }, dots: { channels: false, dms: false } }, { sections: [], empty: 'caught-up', onClearFilters: noop })),
      filtered: scene(() => full({ filter: { kind: 'dms', unreadOnly: false }, dots: { channels: true, dms: false } }, { sections: [], empty: 'filtered', onClearFilters: noop, onViewAll: noop })),
      quiet: scene(() => full({ dots: { channels: false, dms: false } }, { sections: [], empty: 'quiet', onViewAll: noop })),
      // Nothing has arrived from the engine yet: the chrome paints, the list stays blank.
      loading: scene(() => full({ dots: { channels: false, dms: false } }, { sections: [] })),
    },
    Scope: {
      scoped: scene(() => full({ scope: { name: 'eng', kind: 'public' }, dots: { channels: false, dms: false } }, { sections: [{ id: 'recent', ids: [rows.postgres.id, rows.file.id] }] })),
      'scoped-private': scene(() => full({ scope: { name: 'hiring', kind: 'private' }, dots: { channels: false, dms: false } }, { sections: [{ id: 'recent', ids: [rows.hiring.id] }] })),
      'scoped-empty': scene(() => full({ scope: { name: 'design-review', kind: 'public' }, dots: { channels: false, dms: false } }, { sections: [], empty: 'filtered', onClearFilters: noop, onViewAll: noop })),
    },
    // The status line under the filters; the rows stay as they were.
    Sync: {
      offline: scene(() => full({ status: <EngineNotice kind="offline" /> })),
      'rate-limited': scene(() => full({ status: <EngineNotice kind="rate-limited" /> })),
      stopped: scene(() => full({ status: <EngineNotice kind="stopped" onRestart={noop} /> })),
    },
    Nav: {
      // Home tab active, or no tab open.
      'home-active': scene(() => full({ activeNav: 'home' })),
      'all-topics-active': scene(() => full({ activeNav: 'all-topics' })),
      'juno-active': scene(() => full({ activeNav: 'juno' })),
      'juno-unread': scene(() => full({ junoUnread: 3 })),
      // A job runs: the sparkle is duotone, with the count beside it.
      'juno-busy': scene(() => full({ junoUnread: 1, junoBusy: true })),
      'no-dots': scene(() => full({ dots: { channels: false, dms: false } })),
    },
    'Account menu': {
      open: scene(() =>
        full({
          accountMenuOpen: true,
          accountMenu: (
            <AccountMenu
              {...account}
              workspace="juno-fake.slack.com"
              sections={[
                { title: 'Appearance', content: <AppearanceSettings theme="light" accent="coral" layout="stack" onThemeChange={noop} onAccentChange={noop} /> },
              ]}
            />
          ),
        }),
      ),
    },
    Interaction: {
      'row-hover': scene(() => full({}, { selected: rows.postgres.id }), { hover: '[data-topic-row]:nth-of-type(2)' }),
      'filter-hover': scene(() => full(), { hover: '[aria-label="Quick filters"] button:nth-of-type(2)' }),
      'nav-focus': scene(() => full(), { focus: '[aria-label="Pages"] [role="button"]:nth-of-type(2)' }),
    },
  },
  frame,
)
