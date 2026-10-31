import { defineFixtures, scene, TooltipLayer, type FixtureFrame } from '@juno/ui'
import { useState } from 'react'
import { AccountMenu } from './AccountMenu'
import { GalleryAppearanceSettings } from './fixtures/appearance'
import { EngineNotice, SyncProgress } from './EngineStatusView'
import { useFixtureControl } from './juno-chat/fixtures/control'
import { artRows } from './fixtures/artRows'
import { PrivacyOn } from './fixtures/privacy'
import { mixedPinnedIds, mixedRecentIds, mixedRows, mixedSelectedId } from './fixtures/mixedRows'
import { art, hostileIds, newThreadsById, NOW, pinnedIds, recentIds, rows, rowsById } from './fixtures/topics'
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
// The same views with coloured icons (the name pills have no icon to colour).
const colouredViews: ReadonlyArray<SidebarViewPill> = [
  { id: 'automated', name: 'Automated', icon: 'robot', color: 'teal', mention: true },
  { id: 'vwork', name: 'Work', icon: 'briefcase', color: 'midnight', mention: false },
  { id: 'vfriends', name: 'Friends', icon: 'heart', color: 'claret', mention: false },
  { id: 'vrelease', name: 'Releases', icon: 'rocket', color: 'marigold', mention: false },
  { id: 'vbugs', name: 'Bugs', icon: 'bug', color: 'coral', mention: false },
  { id: 'vdesign', name: 'Design crit', mention: false },
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
  onColorChange: noop,
  onKeepOutOfAllChange: noop,
  onQueryChange: noop,
  onToggle: noop,
  onSave: noop,
  onCancel: noop,
}

const mixedById = new Map(mixedRows.map((row) => [row.id, row]))

const renderRow = (id: string, selected?: string) => {
  const row = rowsById.get(id) ?? mixedById.get(id)
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

/**
 * Ninety rows still waiting for their art. The one that gets it is in the
 * middle, far below the view and more than 32 rows from either end, where
 * rows are never skipped (performance.md 3.2).
 */
const waiting = Array.from({ length: 9 }, (_, round) => recentIds.map((id) => ({ ...rowsById.get(id)!, id: `${id}:${round}`, art: undefined }))).flat()
const lastWaiting = `${rows.postgres.id}:4`

/**
 * A middle row's art arrives while it is off screen, through
 * `window.__fixtureControls.art`. The test scrolls it into view after the
 * fade's time and checks that its first frame shows the art at full opacity.
 */
function ArtOffScreen() {
  const [arrived, setArrived] = useState(false)
  useFixtureControl('art', () => setArrived(true))
  const byId = new Map(waiting.map((row) => [row.id, row.id === lastWaiting && arrived ? { ...row, art: art.calendar } : row]))
  return (
    <Sidebar {...chrome}>
      <TopicList
        sections={[{ id: 'recent', ids: waiting.map((row) => row.id) }]}
        renderRow={(id) => {
          const row = byId.get(id)!
          return <TopicRow key={id} row={row} time={relativeTime(row.lastActivityAt, NOW)} selected={false} tabbable={id === waiting[0]!.id} onOpen={noop} />
        }}
        enterEmpty={false}
      />
    </Sidebar>
  )
}

/** Every row with its art, to judge the drawings as a set rather than one by one. */
const artById = new Map(artRows.map((row) => [row.id, row]))
const allArt = (overrides: Partial<SidebarProps> = {}) => (
  <Sidebar {...chrome} {...overrides}>
    <TopicList
      sections={[{ id: 'recent', ids: artRows.map((row) => row.id) }]}
      renderRow={(id) => {
        const row = artById.get(id)!
        return <TopicRow key={id} row={row} time={relativeTime(row.lastActivityAt, NOW)} selected={id === artRows[1]!.id} tabbable={id === artRows[1]!.id} onOpen={noop} />
      }}
      enterEmpty={false}
    />
  </Sidebar>
)

// The first rows a sync brings, for the states with rows.
const firstRows = recentIds.slice(0, 4)

const mixedSections = [
  { id: 'pinned', ids: mixedPinnedIds },
  { id: 'recent', ids: mixedRecentIds },
] as const

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
    // A list as people use it, to judge how calm the rows read together.
    Rows: {
      mixed: scene(() => full({}, { sections: mixedSections, selected: mixedSelectedId }), { ...frame, height: 1100 }),
      'mixed-two-line-titles': scene(() => full({}, { sections: mixedSections, selected: mixedSelectedId }), { ...frame, height: 1100, topicTitleLines: 'two' }),
    },
    Views: {
      overflowing: scene(() => full(viewChrome)),
      'view-selected': scene(() => full({ ...viewChrome, filter: { kind: 'all', unreadOnly: false, view: 'automated' } }, { sections: [{ id: 'recent', ids: [rows.alertsMain.id] }] })),
      'name-selected': scene(() => full({ ...viewChrome, filter: { kind: 'all', unreadOnly: true, view: 'vdesign' } }, { sections: [{ id: 'recent', ids: [rows.roadmap.id] }] })),
      'no-views': scene(() => full({ ...viewChrome, views: [] })),
      coloured: scene(() => full({ ...viewChrome, views: colouredViews })),
      // A coloured icon keeps its colour on the selected pill's fill.
      'coloured-selected': scene(() => full({ ...viewChrome, views: colouredViews, filter: { kind: 'all', unreadOnly: false, view: 'vwork' } }, { sections: [{ id: 'recent', ids: [rows.roadmap.id] }] })),
      'sheet-colour': scene(() => full({ ...viewChrome, views: colouredViews.slice(0, 2), viewSheet: <ViewSheet {...sheetProps} color="teal" /> })),
      'sheet-new': scene(() => full({ ...viewChrome, views: views.slice(0, 2), newViewOpen: true, viewSheet: <ViewSheet {...sheetProps} /> })),
      'sheet-edit': scene(() =>
        full({ ...viewChrome, views: views.slice(0, 2), viewSheet: <ViewSheet {...sheetProps} mode="edit" name="Design crit" icon={undefined} keepOutOfAll={false} query="" chosen={sheetProps.chosen.slice(0, 1)} /> }),
      ),
      // Automated's sheet: what Juno put there says so; #ci-builds the user added.
      'sheet-automated': scene(() =>
        full({
          ...viewChrome,
          views: views.slice(0, 2),
          viewSheet: (
            <ViewSheet
              {...sheetProps}
              mode="edit"
              name="Automated"
              query=""
              results={[]}
              chosen={[...sheetProps.chosen.map((c) => ({ ...c, addedByJuno: true })), { id: 'C0CIBUILDS', name: 'ci-builds', kind: 'public' }]}
            />
          ),
        }),
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
      // The first sync has not brought a topic yet.
      syncing: scene(() => full({ dots: { channels: false, dms: false } }, { sections: [], empty: 'syncing' })),
      'empty-view': scene(() => full({ dots: { channels: false, dms: false } }, { sections: [], empty: 'empty-view', onEditView: noop })),
      // Nothing has arrived from the engine yet: the chrome paints, the list stays blank.
      loading: scene(() => full({ dots: { channels: false, dms: false } }, { sections: [] })),
    },
    Scope: {
      scoped: scene(() => full({ scope: { name: 'eng', kind: 'public' }, dots: { channels: false, dms: false } }, { sections: [{ id: 'recent', ids: [rows.postgres.id, rows.file.id] }] })),
      'scoped-private': scene(() => full({ scope: { name: 'hiring', kind: 'private' }, dots: { channels: false, dms: false } }, { sections: [{ id: 'recent', ids: [rows.hiring.id] }] })),
      'scoped-empty': scene(() => full({ scope: { name: 'design-review', kind: 'public' }, dots: { channels: false, dms: false } }, { sections: [], empty: 'filtered', onClearFilters: noop, onViewAll: noop })),
    },
    // The status card at the foot of the sidebar; the rows stay as they were.
    Sync: {
      listing: scene(() => full({ dots: { channels: false, dms: false }, status: <SyncProgress /> }, { sections: [], empty: 'syncing' })),
      'first sync': scene(() => full({ dots: { channels: false, dms: false }, status: <SyncProgress done={11} total={148} /> }, { sections: [], empty: 'syncing' })),
      'first sync rows': scene(() => full({ status: <SyncProgress done={64} total={148} /> }, { sections: [{ id: 'recent', ids: firstRows }] })),
      offline: scene(() => full({ status: <EngineNotice kind="offline" /> })),
      failed: scene(() => full({ status: <EngineNotice kind="failed" reason="Slack sent data Juno can't read." onCopyLog={noop} /> })),
      'rate-limited': scene(() => full({ status: <EngineNotice kind="rate-limited" /> })),
      stopped: scene(() => full({ status: <EngineNotice kind="stopped" onRestart={noop} /> })),
      'with privacy': scene(() => <PrivacyOn>{full({ status: <EngineNotice kind="offline" />, privacy: true, onPrivacyOff: noop })}</PrivacyOn>),
    },
    Nav: {
      // Home tab active, or no tab open: Home is the title bar's button, with the nav's active look.
      'home-active': scene(() => full({ activeNav: 'home' })),
      // All topics is the title bar's button: it takes the nav's active look.
      'all-topics-active': scene(() => full({ activeNav: 'all-topics' })),
      'juno-active': scene(() => full({ activeNav: 'juno' })),
      'juno-unread': scene(() => full({ junoUnread: 3 })),
      // A job runs: the sparkle is duotone, with the count beside it.
      'juno-busy': scene(() => full({ junoUnread: 1, junoBusy: true })),
      'no-dots': scene(() => full({ dots: { channels: false, dms: false } })),
    },
    // Art that arrives while its row is off screen shows whole when the row scrolls in.
    Art: {
      'off-screen': scene(() => <ArtOffScreen />),
      'every-row': scene(() => allArt()),
      'every-row-privacy': scene(() => <PrivacyOn>{allArt({ privacy: true, onPrivacyOff: noop })}</PrivacyOn>),
    },
    // Privacy mode (SPEC section 5): previews and first-words titles blurred, the footer with Show.
    // Sharing: turned on because the screen is shared, and the footer says so.
    Privacy: {
      sharing: scene(() => <PrivacyOn>{full({ privacy: true, privacySharing: true, onPrivacyOff: noop })}</PrivacyOn>),
      on: scene(() => <PrivacyOn>{full({ privacy: true, onPrivacyOff: noop }, { selected: rows.postgres.id })}</PrivacyOn>),
      'row-hover': scene(() => <PrivacyOn>{full({ privacy: true, onPrivacyOff: noop })}</PrivacyOn>, { hover: '[data-topic-row]:nth-of-type(2)' }),
    },
    // The title bar's and the pills' tooltips (primitives, Tooltip): the shot waits out the hover delay.
    Tooltips: {
      back: scene(
        () => (
          <>
            {full()}
            <TooltipLayer />
          </>
        ),
        { tooltip: '[aria-label="Back ⌘["]' },
      ),
      'all-topics': scene(
        () => (
          <>
            {full()}
            <TooltipLayer />
          </>
        ),
        { tooltip: '[aria-label="All topics"]' },
      ),
      home: scene(
        () => (
          <>
            {full()}
            <TooltipLayer />
          </>
        ),
        { tooltip: '[aria-label="Home"]' },
      ),
      'view-pill': scene(
        () => (
          <>
            {full({ ...viewChrome, views: colouredViews })}
            <TooltipLayer />
          </>
        ),
        { tooltip: '[data-view-pill="vwork"]' },
      ),
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
                { title: 'Appearance', content: <GalleryAppearanceSettings layout="stack" onThemeChange={noop} onAccentChange={noop} /> },
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
      'nav-focus': scene(() => full(), { focus: '[aria-label="Pages"] [role="button"]' }),
      'home-hover': scene(() => full(), { hover: '[aria-label="Sidebar title bar"] [aria-label="Home"]' }),
      'home-focus': scene(() => full(), { focus: '[aria-label="Sidebar title bar"] [aria-label="Home"]' }),
      // The first pill sits on the row's start edge; its ring must show whole.
      'filter-focus': scene(() => full(viewChrome), { focus: '[aria-label="Quick filters"] [aria-label="All"]' }),
      // A view pill half under the row's end: keyboard focus scrolls it in, ring and all.
      'view-focus': scene(() => full(viewChrome), { focus: '[data-view-pill="vfriends"]' }),
      'row-focus': scene(() => full({}, { selected: rows.postgres.id }), { focus: '[data-topic-row][tabindex="0"]' }),
    },
  },
  frame,
)
