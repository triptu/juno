import type { ReactNode } from 'react'
import { defineFixtures, scene } from '@juno/ui'
import { AppearanceSettings } from './AppearanceSettings'
import { NOW, pinnedIds, recentIds, rows, rowsById } from './fixtures/topics'
import { SettingsPage } from './SettingsPage'
import { SettingsAppearance } from './SettingsSections'
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

/**
 * The signed-in window with fixture rows. `peek` fills the shell's peek slot, `page` the workspace.
 * `fullScreen` draws the title bars as in macOS full screen, with no room for the traffic lights.
 */
export function SignedIn({ width, hidden = false, fullScreen = false, peek, page }: { readonly width?: number; readonly hidden?: boolean; readonly fullScreen?: boolean; readonly peek?: ReactNode; readonly page?: ReactNode }) {
  return (
    <Shell
      {...(width === undefined ? {} : { sidebarWidth: width })}
      sidebarHidden={hidden}
      onSidebarResize={noop}
      onSidebarResetWidth={noop}
      onSidebarCollapse={noop}
      peek={peek}
      sidebar={
        <Sidebar
          titlebarLeading={nav(false)}
          fullScreen={fullScreen}
          account={{ name: 'Tushar', initials: 'T', hue: 'cyan' }}
          filter={{ kind: 'all', unreadOnly: false }}
          dots={{ channels: true, dms: true }}
          accountMenuOpen={false}
          onAccountMenu={noop}
          onSearch={noop}
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
      <Workspace tabs={workspaceTabs} activeId={page === undefined ? 'postgres' : 'pinned'} {...(hidden ? { leading: nav(true) } : {})} fullScreen={fullScreen}>
        {page}
      </Workspace>
    </Shell>
  )
}

export default defineFixtures(
  Shell,
  {
    Window: {
      'signed-in': scene(() => <SignedIn />),
      'sidebar-narrowest': scene(() => <SignedIn width={312} />),
      'sidebar-widest': scene(() => <SignedIn width={480} />),
      'sidebar-hidden': scene(() => <SignedIn hidden />),
      'sidebar-hidden-minimum-window': scene(() => <SignedIn hidden />, { width: 720, height: 480 }),
      // macOS hides the traffic lights in full screen, so the title bars start at their own padding.
      'full-screen': scene(() => <SignedIn fullScreen />),
      'full-screen-sidebar-hidden': scene(() => <SignedIn hidden fullScreen />),
      // The minimum window with the sidebar shown and Settings open: its list is a rail of icons, and no title bar icon is current.
      'settings-minimum-window': scene(
        () => (
          <SignedIn
            page={
              <SettingsPage section="appearance" onSection={noop}>
                <SettingsAppearance theme="system" accent="coral" density="compact" onThemeChange={noop} onAccentChange={noop} onDensityChange={noop} />
              </SettingsPage>
            }
          />
        ),
        { width: 720, height: 480 },
      ),
      'signed-out': scene(() => (
        <Shell>
          <SignInView mode="first-run" onImport={noop} />
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
