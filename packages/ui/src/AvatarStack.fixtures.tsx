import { AvatarStack, type AvatarStackPerson } from './AvatarStack'
import { defineFixtures, fixture } from './fixtures/define'

const photo = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#8EB5C9"/><circle cx="32" cy="26" r="12" fill="#F4E6D3"/><path d="M10 64c2-14 11-20 22-20s20 6 22 20Z" fill="#F4E6D3"/></svg>',
)}`

const people: ReadonlyArray<AvatarStackPerson> = [
  { id: 'u1', initials: 'MC', name: 'Maya Chen', hue: 'claret' },
  { id: 'u2', initials: 'LP', name: 'Leo Park', hue: 'midnight' },
  { id: 'u3', initials: 'DP', name: 'Dev Patel', hue: 'cyan' },
  { id: 'u4', initials: 'SO', name: 'Sam Okafor', hue: 'emeraldDark' },
  { id: 'u5', initials: 'PR', name: 'Priya Raman', hue: 'plum' },
]

export default defineFixtures(
  AvatarStack,
  {
    People: {
      two: fixture({ people: people.slice(0, 2) }),
      four: fixture({ people }),
      'two-at-20': fixture({ people: people.slice(0, 2), size: 20 }),
      // Photos where Slack has them, initials where it does not.
      'with-photos': fixture({ people: people.map((person, index) => (index % 2 === 0 ? { ...person, src: photo } : person)) }),
    },
    Surface: {
      'on-background': fixture({ people, surface: 'background' }, { surface: 'background' }),
      'on-card': fixture({ people, surface: 'surface' }, { surface: 'surface' }),
    },
  },
  { surface: 'subtle' },
)
