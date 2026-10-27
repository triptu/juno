import { AvatarButton } from './AvatarButton'
import { defineFixtures, fixture } from './fixtures/define'

const photo = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#8EB5C9"/><circle cx="32" cy="26" r="12" fill="#F4E6D3"/><path d="M10 64c2-14 11-20 22-20s20 6 22 20Z" fill="#F4E6D3"/></svg>',
)}`

const base = { label: 'Account and settings', initials: 'T', hue: 'cyan' } as const

export default defineFixtures(
  AvatarButton,
  {
    Photo: {
      initials: fixture(base),
      photo: fixture({ ...base, src: photo }),
    },
    Presence: {
      active: fixture({ ...base, src: photo, presence: 'active' }),
      away: fixture({ ...base, src: photo, presence: 'away' }),
      'active-hover': fixture({ ...base, presence: 'active' }, { hover: 'button' }),
      'away-open': fixture({ ...base, presence: 'away', open: true }),
    },
    // Notifications paused: the dot becomes a snooze badge, green while active.
    Paused: {
      active: fixture({ ...base, src: photo, presence: 'active', paused: 'Paused until 9am' }),
      away: fixture({ ...base, src: photo, presence: 'away', paused: 'Paused until 9am' }),
      initials: fixture({ ...base, presence: 'away', paused: 'Paused until 9am' }),
    },
    // The menu's open fill is the hover fill, through the press too, so opening changes no colour (gallery trigger-open spec).
    Open: {
      'avatar-hover': fixture(base, { hover: 'button' }),
      'avatar-press': fixture(base, { press: 'button' }),
      'avatar-open': fixture({ ...base, open: true }),
      'avatar-open-hover': fixture({ ...base, open: true }, { hover: 'button' }),
    },
    Interaction: {
      focus: fixture(base, { focus: 'button' }),
    },
  },
  { surface: 'subtle' },
)
