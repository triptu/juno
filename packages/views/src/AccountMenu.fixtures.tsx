import { Button, defineFixtures, fixture, Text } from '@juno/ui'
import { AccountMenu } from './AccountMenu'

const noop = () => {}

const base = { name: 'Tushar', initials: 'T', hue: 'cyan', workspace: 'juno-fake.slack.com', onAction: noop, sections: [] } as const

const session = {
  title: 'Session',
  content: (
    <>
      <Text variant="meta" tone="muted" as="p">
        Signed in to Juno Fake as tushar
      </Text>
      <Button variant="ghost" size="sm" tone="muted">
        Sign out
      </Button>
    </>
  ),
}

export default defineFixtures(
  AccountMenu,
  {
    Presence: {
      active: fixture({ ...base, presence: { active: true, label: 'Active' } }),
      'away-paused': fixture({ ...base, presence: { active: false, label: 'Away until 9am' }, paused: 'Paused until 9am' }),
      'active-by-hand': fixture({ ...base, presence: { active: true, label: 'Active until 8pm' } }),
      unknown: fixture({ ...base }),
    },
    Privacy: {
      on: fixture({ ...base, presence: { active: true, label: 'Active' }, privacy: true }),
    },
    Sections: {
      'with-session': fixture({ ...base, presence: { active: true, label: 'Active' }, sections: [session] }),
    },
    Interaction: {
      'hover-item': fixture({ ...base, presence: { active: true, label: 'Active' } }, { hover: '[role="menuitem"]:nth-of-type(2)' }),
    },
  },
  { width: 280, surface: 'surface' },
)
