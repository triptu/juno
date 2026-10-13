import { defineFixtures, fixture } from '@juno/ui'
import { customReaction, reaction } from './fixtures/messages'
import { Reactions } from './Reactions'

const few = [reaction('+1', '👍', 2, true), reaction('eyes', '👀', 1)]
const many = Array.from({ length: 24 }, (_, index) => reaction(`emoji-${index}`, String.fromCodePoint(0x1f600 + index), 1 + (index % 5), index % 7 === 0))

export default defineFixtures(
  Reactions,
  {
    Display: {
      few: fixture({ reactions: few }),
      'none-mine': fixture({ reactions: [reaction('+1', '👍', 2), reaction('rocket', '🚀', 1)] }),
      custom: fixture({ reactions: [customReaction('party-blob', 3, true), { name: 'blob-wave', count: 1, me: false }] }),
      many: fixture({ reactions: many }),
    },
    Toggle: {
      toggleable: fixture({ reactions: few, onToggle: () => {} }),
      'hover-chip': fixture({ reactions: few, onToggle: () => {} }, { hover: 'button' }),
      'press-chip': fixture({ reactions: few, onToggle: () => {} }, { press: 'button' }),
    },
  },
  { width: 480 },
)
