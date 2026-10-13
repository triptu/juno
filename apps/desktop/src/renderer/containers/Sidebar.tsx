import { startTransition, useState } from 'react'
import type { KindFilter } from '@juno/contract'
import { accentAtom, persistAccent, persistTheme, sidebarFilterAtom, signedInAtom, themeAtom, topicCountsAtom, type Accent, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AccountMenu, AppearanceSettings, hueFor, initials, Sidebar as SidebarView, type SidebarNavTarget } from '@juno/views'
import { AppInfo } from './AppInfo'
import { EngineStatus } from './EngineStatus'
import { markFilterChange } from './filterMark'
import { Session } from './Session'
import { TopicList } from './TopicList'

/**
 * Wires the sidebar chrome: the filters and scope (local UI state), the
 * filter dots (the counts live value), the theme toggle, and the account
 * menu, which holds the appearance settings and the M1 diagnostics until
 * Preferences exists.
 */
export function Sidebar() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const [filter, setFilter] = useAtom(sidebarFilterAtom)
  const counts = useAtomValue(topicCountsAtom(filter.scope))
  const user = useAtomValue(signedInAtom)
  const [menuOpen, setMenuOpen] = useState(false)

  const name = user?.userName ?? ''
  const account = { name, initials: initials(name) || '?', hue: hueFor('', user?.userId ?? '') }

  const changeTheme = (next: Theme) => {
    setTheme(next)
    persistTheme(next)
  }
  const changeAccent = (next: Accent) => {
    setAccent(next)
    persistAccent(next)
  }

  const changeKind = (kind: KindFilter) => {
    if (kind === filter.kind) return
    markFilterChange()
    // The old rows stay until the new window arrives; never a blank list in between (performance.md 5.3).
    startTransition(() => setFilter({ ...filter, kind }))
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

  const navigate = (target: SidebarNavTarget) => {
    // TODO(M4/M9/M11): open the All topics, For you or Juno page in a tab.
    void target
  }

  const dots = {
    channels: counts._tag === 'Success' && counts.value.channelsUnread > 0,
    dms: counts._tag === 'Success' && counts.value.dmsUnread > 0,
  }

  return (
    <SidebarView
      account={account}
      theme={theme}
      forYouCount={0}
      filter={{ kind: filter.kind, unreadOnly: filter.unreadOnly }}
      dots={dots}
      {...(filter.scope === undefined ? {} : { scope: { name: filter.scope, kind: 'public' as const } })}
      accountMenuOpen={menuOpen}
      onAccountMenu={setMenuOpen}
      accountMenu={
        <AccountMenu
          {...account}
          workspace={user?.teamName ?? ''}
          sections={[
            { title: 'Appearance', content: <AppearanceSettings theme={theme} accent={accent} layout="stack" onThemeChange={changeTheme} onAccentChange={changeAccent} /> },
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
      onBrowse={() => {
        // TODO(M3 Browse): open the Browse channels and people popover.
      }}
      onToggleTheme={() => changeTheme(theme === 'dark' ? 'light' : 'dark')}
      onNewMessage={() => {
        // TODO(M6): open the New message page.
      }}
      onNavigate={navigate}
      onFilterKind={changeKind}
      onToggleUnread={toggleUnread}
      onClearScope={clearScope}
    >
      <TopicList />
    </SidebarView>
  )
}
