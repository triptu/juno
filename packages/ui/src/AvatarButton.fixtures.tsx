import { AvatarButton } from './AvatarButton'
import { defineFixtures, fixture } from './fixtures/define'

const photo = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#8EB5C9"/><circle cx="32" cy="26" r="12" fill="#F4E6D3"/><path d="M10 64c2-14 11-20 22-20s20 6 22 20Z" fill="#F4E6D3"/></svg>',
)}`

const base = { label: 'Account and preferences', initials: 'T', hue: 'cyan' } as const

export default defineFixtures(
  AvatarButton,
  {
    Photo: {
      initials: fixture(base),
      photo: fixture({ ...base, src: photo }),
    },
    Menu: {
      open: fixture({ ...base, open: true }),
    },
    Interaction: {
      hover: fixture(base, { hover: 'button' }),
      press: fixture(base, { press: 'button' }),
      focus: fixture(base, { focus: 'button' }),
    },
  },
  { surface: 'subtle' },
)
