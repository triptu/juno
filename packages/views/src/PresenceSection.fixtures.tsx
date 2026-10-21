import { defineFixtures, fixture } from '@juno/ui'
import { PresenceSection } from './PresenceSection'

const noop = () => {}

export default defineFixtures(
  PresenceSection,
  {
    Value: {
      on: fixture({ showPresence: true, onShowPresenceChange: noop }),
      off: fixture({ showPresence: false, onShowPresenceChange: noop }),
    },
  },
  { width: 760, height: 200 },
)
