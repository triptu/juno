import { defineFixtures, fixture } from '@juno/ui'
import { AccountMenu } from './AccountMenu'

const noop = () => {}

// When each choice would end if picked at 2:30pm on a Thursday.
const pauseEnds = { '30m': '3pm', '1h': '3:30pm', '2h': '4:30pm', tomorrow: 'Fri 9am', nextWeek: 'Mon 9am' } as const

const base = { name: 'Tushar', initials: 'T', hue: 'cyan', workspace: 'juno-fake.slack.com', onAction: noop } as const

// Sign out with who is signed in, as the app passes it once the session is ready (containers/AccountMenuContent.tsx).
const session = { line: 'Signed in to Juno Fake as tushar', onSignOut: noop }

export default defineFixtures(
  AccountMenu,
  {
    Presence: {
      active: fixture({ ...base, presence: { active: true, seen: true, label: 'Active' } }),
      'away-paused': fixture({ ...base, presence: { active: false, seen: false, label: 'Away until 9am' }, paused: 'Paused until 9am' }),
      // Outside notification hours while active: the snooze badge is green, as the line says.
      'active-paused': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, paused: 'Paused until 9am' }),
      'active-by-hand': fixture({ ...base, presence: { active: true, seen: true, label: 'Active until 8pm' } }),
      // Set active, but Slack shows colleagues away: the dot follows Slack, the toggle the setting.
      'active-shown-away': fixture({ ...base, presence: { active: true, seen: false, label: 'Active. Slack shows you away' } }),
      'active-connecting': fixture({ ...base, presence: { active: true, seen: false, label: 'Active. Connecting to Slack' } }),
      unknown: fixture({ ...base }),
    },
    Status: {
      'with-status': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, status: { emoji: { name: 'spiral_calendar_pad', unicode: '🗓️' }, text: 'In a meeting', until: 'until 3:30pm' } }),
      'no-expiry': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, status: { emoji: { name: 'palm_tree', unicode: '🌴' }, text: 'Vacationing' } }),
      'long-text': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, status: { emoji: { name: 'house_with_garden', unicode: '🏡' }, text: 'Working from the north office this week, back in the city on Monday', until: 'until Fri' } }),
      'missing-emoji': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, status: { emoji: { name: 'party_parrot_wave_long_name' }, text: 'Out at the dentist until the afternoon, then catching up on reviews', until: 'until 5pm' } }),
    },
    // Pause notifications (Slack's snooze): the item, and Resume while snoozed. The submenu needs the app's popover around the menu: the screenshots in the browser lane show it.
    Pause: {
      offered: fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, pauseEnds, onPause: noop }),
      snoozed: fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, paused: 'Paused until 3:30pm', snoozed: true, snoozeLabel: 'Paused until 3:30pm', onPause: noop }),
    },
    Privacy: {
      on: fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, privacy: true }),
    },
    Session: {
      'with-session': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, session }),
      'signing-out': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' }, session: { ...session, signingOut: true } }),
    },
    Interaction: {
      'hover-item': fixture({ ...base, presence: { active: true, seen: true, label: 'Active' } }, { hover: '[role="menuitem"]:nth-of-type(2)' }),
    },
  },
  { width: 280, surface: 'raised' },
)
