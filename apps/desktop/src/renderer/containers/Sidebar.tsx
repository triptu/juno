import { startTransition, useState } from 'react'
import type { KindFilter } from '@juno/contract'
import { accentAtom, persistAccent, persistTheme, sidebarDotAtom, sidebarFilterAtom, sidebarListAtom, signedInAtom, themeAtom, type Accent, type Theme } from '@juno/state'
import { useAtom, useAtomValue } from '@juno/state/react'
import { AccountMenu, AppearanceSettings, hueFor, initials, Sidebar as SidebarView, type SidebarNavTarget } from '@juno/views'
import { AppInfo } from './AppInfo'
import { EngineStatus, SyncNotice } from './EngineStatus'
import { markFilterChange } from './filterMark'
import { Session } from './Session'
import { TopicList } from './TopicList'

function navigate(target: SidebarNavTarget): void {
  // TODO(M5/M9/M11): open the All topics, For you or Juno page in a tab.
  void target
}

/**
 * Wires the sidebar chrome: the filters and scope (local UI state), the
 * filter dots (booleans from the counts live value, so a count that changes
 * without a dot changing re-renders nothing), the sync status line, the
 * theme toggle, and the account menu, which holds the appearance settings
 * and the M1 diagnostics until Preferences exists. The list is a memoized
 * child with no props, so a render here does not reach the rows.
 */
export function Sidebar() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [accent, setAccent] = useAtom(accentAtom)
  const [filter, setFilter] = useAtom(sidebarFilterAtom)
  const channelsDot = useAtomValue(sidebarDotAtom('channels'))
  const dmsDot = useAtomValue(sidebarDotAtom('dms'))
  const user = useAtomValue(signedInAtom)
  const [menuOpen, setMenuOpen] = useState(false)
  // The scope chip names the channel the list is narrowed to; its rows' refs carry it.
  const scopeChannel = useAtomValue(sidebarListAtom, (list) => (filter.scope === undefined ? undefined : list.refs.channels.get(filter.scope)))

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

  const dots = { channels: channelsDot, dms: dmsDot }

  return (
    <SidebarView
      account={account}
      theme={theme}
      forYouCount={0}
      filter={{ kind: filter.kind, unreadOnly: filter.unreadOnly }}
      dots={dots}
      {...(filter.scope === undefined ? {} : { scope: { name: scopeChannel?.name ?? filter.scope, kind: scopeChannel?.kind ?? 'public' } })}
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
      status={<SyncNotice />}
    >
      <TopicList />
    </SidebarView>
  )
}
