import { defineFixtures, scene } from '@juno/ui'
import { AppearanceSettings } from './AppearanceSettings'
import { NOW, pinnedIds, recentIds, rows, rowsById } from './fixtures/topics'
import { Shell } from './Shell'
import { Sidebar } from './Sidebar'
import { SignInView } from './SignInView'
import { relativeTime } from './time'
import { TopicList } from './TopicList'
import { TitlebarNav } from './TitlebarNav'
import { TopicRow } from './TopicRow'
import { Workspace } from './Workspace'

const noop = () => {}

const workspaceTabs = [
  { id: 'pinned', title: 'eng', icon: 'hash', pinned: true },
  { id: 'postgres', title: 'Postgres 16 migration plan', icon: 'hash' },
  { id: 'density', title: 'Thread list density', icon: 'hash', unread: true },
] as const

const nav = (hidden: boolean) => <TitlebarNav sidebarHidden={hidden} canGoBack canGoForward={false} onToggleSidebar={noop} onBack={noop} onForward={noop} />

function SignedIn({ width, hidden = false }: { readonly width?: number; readonly hidden?: boolean }) {
  return (
    <Shell
      {...(width === undefined ? {} : { sidebarWidth: width })}
      sidebarHidden={hidden}
      onSidebarResize={noop}
      onSidebarResetWidth={noop}
      onSidebarCollapse={noop}
      sidebar={
        <Sidebar
          titlebarLeading={nav(false)}
          account={{ name: 'Tushar', initials: 'T', hue: 'cyan' }}
          theme="light"
          forYouCount={5}
          filter={{ kind: 'all', unreadOnly: false }}
          dots={{ channels: true, dms: true }}
          accountMenuOpen={false}
          onAccountMenu={noop}
          onSearch={noop}
          onBrowse={noop}
          onToggleTheme={noop}
          onNavigate={noop}
          onFilterKind={noop}
          onToggleUnread={noop}
          onClearScope={noop}
        >
          <TopicList
            sections={[
              { id: 'pinned', ids: pinnedIds },
              { id: 'recent', ids: recentIds },
            ]}
            renderRow={(id) => {
              const row = rowsById.get(id)
              return row === undefined ? null : (
                <TopicRow key={id} row={row} time={relativeTime(row.lastActivityAt, NOW)} selected={id === rows.postgres.id} tabbable={id === rows.postgres.id} onOpen={noop} onResolve={noop} />
              )
            }}
          />
        </Sidebar>
      }
    >
      <Workspace tabs={workspaceTabs} activeId="postgres" {...(hidden ? { leading: nav(true) } : {})} />
    </Shell>
  )
}

export default defineFixtures(
  Shell,
  {
    Window: {
      'signed-in': scene(() => <SignedIn />),
      'sidebar-narrowest': scene(() => <SignedIn width={280} />),
      'sidebar-widest': scene(() => <SignedIn width={480} />),
      'sidebar-hidden': scene(() => <SignedIn hidden />),
      'sidebar-hidden-minimum-window': scene(() => <SignedIn hidden />, { width: 720, height: 480 }),
      'signed-out': scene(() => (
        <Shell>
          <SignInView mode="first-run" onSignIn={noop} onImport={noop} />
          <AppearanceSettings theme="light" accent="coral" onThemeChange={noop} onAccentChange={noop} />
        </Shell>
      )),
    },
    Interaction: {
      'hover-resize-edge': scene(() => <SignedIn />, { hover: '[role="separator"][aria-label="Resize sidebar"]' }),
    },
  },
  { width: 1200, height: 720, padded: false },
)
