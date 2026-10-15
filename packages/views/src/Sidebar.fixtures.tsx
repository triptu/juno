import { defineFixtures, scene, type FixtureFrame } from '@juno/ui'
import { AccountMenu } from './AccountMenu'
import { AppearanceSettings } from './AppearanceSettings'
import { EngineNotice } from './EngineStatusView'
import { PrivacyOn } from './fixtures/privacy'
import { hostileIds, newThreadsById, NOW, pinnedIds, recentIds, rows, rowsById } from './fixtures/topics'
import { Sidebar, type SidebarProps, type SidebarViewPill } from './Sidebar'
import { relativeTime } from './time'
import { TitlebarNav } from './TitlebarNav'
import { TopicList, type TopicListProps } from './TopicList'
import { TopicRow } from './TopicRow'
import { ViewSheet, type ViewSheetProps } from './ViewSheet'

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

// Views (spec section 5): the built-in Automated first, then icon pills and name pills, enough to overflow a 384px sidebar.
const views: ReadonlyArray<SidebarViewPill> = [
  { id: 'automated', name: 'Automated', icon: 'robot', mention: true },
  { id: 'vdesign', name: 'Design crit', mention: false },
  { id: 'vlead', name: 'Leadership', mention: false },
  { id: 'vwork', name: 'Work', icon: 'briefcase', mention: false },
  { id: 'vlong', name: 'Customer escalations and incident follow-ups', mention: true },
  { id: 'vfriends', name: 'Friends', icon: 'heart', mention: false },
]
const viewChrome = { views, onFilterView: noop, onNewView: noop, onViewMenu: noop, onMoveView: noop, onCloseViewSheet: noop } as const

const sheetProps: ViewSheetProps = {
  mode: 'new',
  name: 'Bots',
  icon: 'robot',
  keepOutOfAll: true,
  chosen: [
    { id: 'C0ALERTSPROD', name: 'alerts-prod', kind: 'public' },
    { id: 'C0DEPLOYS', name: 'deploys', kind: 'public' },
    { id: 'D0GRAFANA', name: 'Grafana', kind: 'im' },
  ],
  query: 'alerts',
  results: [
    { id: 'C0ALERTSPROD', name: 'alerts-prod', kind: 'public' },
    { id: 'C0ALERTSSTAGING', name: 'alerts-staging', kind: 'public' },
    { id: 'C0ALERTSBILLING', name: 'alerts-billing', kind: 'private' },
  ],
  onNameChange: noop,
  onIconChange: noop,
  onKeepOutOfAllChange: noop,
  onQueryChange: noop,
  onToggle: noop,
  onSave: noop,
  onCancel: noop,
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
    // The filter row as scrollable pills (inventory 2.3): it never grows taller than the row of three.
    Views: {
      overflowing: scene(() => full(viewChrome)),
      'view-selected': scene(() => full({ ...viewChrome, filter: { kind: 'all', unreadOnly: false, view: 'automated' } }, { sections: [{ id: 'recent', ids: [rows.alertsMain.id] }] })),
      'name-selected': scene(() => full({ ...viewChrome, filter: { kind: 'all', unreadOnly: true, view: 'vdesign' } }, { sections: [{ id: 'recent', ids: [rows.roadmap.id] }] })),
      'no-views': scene(() => full({ ...viewChrome, views: [] })),
      'sheet-new': scene(() => full({ ...viewChrome, views: views.slice(0, 2), viewSheet: <ViewSheet {...sheetProps} /> })),
      'sheet-edit': scene(() =>
        full({ ...viewChrome, views: views.slice(0, 2), viewSheet: <ViewSheet {...sheetProps} mode="edit" name="Design crit" icon={undefined} keepOutOfAll={false} query="" chosen={sheetProps.chosen.slice(0, 1)} /> }),
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
    // Privacy mode (SPEC section 5): previews blurred, the footer with Show.
    Privacy: {
      on: scene(() => <PrivacyOn>{full({ privacy: true, onPrivacyOff: noop }, { selected: rows.postgres.id })}</PrivacyOn>),
      'row-hover': scene(() => <PrivacyOn>{full({ privacy: true, onPrivacyOff: noop })}</PrivacyOn>, { hover: '[data-topic-row]:nth-of-type(2)' }),
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
      'filter-hover': scene(() => full(), { hover: '[aria-label="Quick filters"] [aria-label^="Channels"]' }),
      'unread-hover': scene(() => full(), { hover: '[aria-label="Unread only"]' }),
      'unread-focus': scene(() => full(), { focus: '[aria-label="Unread only"]' }),
      'view-hover': scene(() => full(viewChrome), { hover: '[data-view-pill="vdesign"]' }),
      'nav-focus': scene(() => full(), { focus: '[aria-label="Pages"] [role="button"]:nth-of-type(2)' }),
    },
  },
  frame,
)
