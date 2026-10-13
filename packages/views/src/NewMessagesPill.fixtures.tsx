import { defineFixtures, fixture } from '@juno/ui'
import { NewMessagesPill } from './NewMessagesPill'

const noop = () => {}

export default defineFixtures(NewMessagesPill, {
  Count: {
    one: fixture({ count: 1, onJump: noop }),
    many: fixture({ count: 12, onJump: noop }),
    'jump-to-latest': fixture({ count: 0, onJump: noop }),
  },
  Interaction: {
    hover: fixture({ count: 2, onJump: noop }, { hover: 'button' }),
    press: fixture({ count: 2, onJump: noop }, { press: 'button' }),
  },
})
