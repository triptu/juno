import { defineFixtures, fixture } from '@juno/ui'
import { AccountMenu } from './AccountMenu'
import { SessionView } from './SessionView'

const noop = () => {}

const base = { name: 'Tushar', initials: 'T', hue: 'cyan', workspace: 'juno-fake.slack.com', onAction: noop, sections: [] } as const

// The app's Session block: the account line and Sign out (containers/Session.tsx).
const session = {
  title: 'Session',
  content: <SessionView teamName="Juno Fake" userName="tushar" onSignOut={noop} />,
}

export default defineFixtures(
  AccountMenu,
  {
    Presence: {
      active: fixture({ ...base, presence: { active: true, seen: true, label: 'Active' } }),
      'away-paused': fixture({ ...base, presence: { active: false, seen: false, label: 'Away until 9am' }, paused: 'Paused until 9am' }),
      'active-by-hand': fixture({ ...base, presence: { active: true, seen: true, label: 'Active until 8pm' } }),
      // Set active, but Slack shows colleagues away: the dot follows Slack, the toggle the setting.
      'active-shown-away': fixture({ ...base, presence: { active: true, seen: false, label: 'Active. Slack shows you away' } }),
      'active-connecting': fixture({ ...base, presence: { active: true, seen: false, label: 'Active. Connecting to Slack' } }),
      unknown: fixture({ ...base }),
    },
    Privacy: {
      on: fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, privacy: true }),
    },
    Sections: {
      'with-session': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, sections: [session] }),
    },
    Interaction: {
      'hover-item': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' } }, { hover: '[role="menuitem"]:nth-of-type(2)' }),
    },
  },
  { width: 280, surface: 'raised' },
)
