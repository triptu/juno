import { defineFixtures, scene } from '@juno/ui'
import { AppearanceSettings } from './AppearanceSettings'
import { NOW, pinnedIds, recentIds, rows, rowsById } from './fixtures/topics'
import { Shell } from './Shell'
import { Sidebar } from './Sidebar'
import { SignInView } from './SignInView'
import { relativeTime } from './time'
import { TopicList } from './TopicList'
import { TopicRow } from './TopicRow'
import { Workspace } from './Workspace'

const noop = () => {}

function SignedIn() {
  return (
    <Shell
      sidebar={
        <Sidebar
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
          onNewMessage={noop}
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
      <Workspace />
    </Shell>
  )
}

export default defineFixtures(
  Shell,
  {
    Window: {
      'signed-in': scene(() => <SignedIn />),
      'signed-out': scene(() => (
        <Shell>
          <SignInView mode="first-run" onSignIn={noop} onImport={noop} />
          <AppearanceSettings theme="light" accent="coral" onThemeChange={noop} onAccentChange={noop} />
        </Shell>
      )),
    },
  },
  { width: 1200, height: 720, padded: false },
)
