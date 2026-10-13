import { defineFixtures, fixture } from '@juno/ui'
import { HoverToolbar } from './HoverToolbar'

export default defineFixtures(HoverToolbar, {
  Where: {
    thread: fixture({}),
    main: fixture({ main: true }),
  },
  Interaction: {
    'hover-reaction': fixture({ main: true }, { hover: 'button' }),
    'hover-quote': fixture({ main: true }, { hover: '[aria-label="Quote"]' }),
    'press-reaction': fixture({ main: true }, { press: 'button' }),
    'focus-reply': fixture({ main: true }, { focus: '[aria-label="Reply in thread"]' }),
  },
})
