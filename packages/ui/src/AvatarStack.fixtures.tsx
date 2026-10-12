import { AvatarStack, type AvatarStackPerson } from './AvatarStack'
import { defineFixtures, fixture } from './fixtures/define'

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
    two: fixture({ people: people.slice(0, 2) }),
    four: fixture({ people }),
    'two-at-20': fixture({ people: people.slice(0, 2), size: 20 }),
    'on-background': fixture({ people, surface: 'background' }, { surface: 'background' }),
    'on-card': fixture({ people, surface: 'surface' }, { surface: 'surface' }),
  },
  { surface: 'subtle' },
)
