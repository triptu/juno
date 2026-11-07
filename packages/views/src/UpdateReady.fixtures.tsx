import { defineFixtures, fixture } from '@juno/ui'
import { UpdateReady } from './UpdateReady'

const noop = () => {}

// The card the sidebar's footer shows once an update has downloaded; `Sidebar` › Update shows it in place.
export default defineFixtures(
  UpdateReady,
  {
    Ready: {
      default: fixture({ version: '0.1.15', onRestart: noop, onOpen: noop }),
      // A long pre-release version takes the ellipsis; the title and Restart stay whole.
      'long version': fixture({ version: '0.12.104-beta.3+build.20261107', onRestart: noop, onOpen: noop }),
    },
  },
  { width: 312, padded: true, surface: 'subtle' },
)
