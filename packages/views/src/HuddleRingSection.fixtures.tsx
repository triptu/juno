import { defineFixtures, fixture } from '@juno/ui'
import { HuddleRingSection } from './HuddleRingSection'

const noop = () => {}

export default defineFixtures(
  HuddleRingSection,
  {
    Value: {
      on: fixture({ huddleRing: true, onHuddleRingChange: noop }),
      off: fixture({ huddleRing: false, onHuddleRingChange: noop }),
    },
  },
  { width: 760, height: 200 },
)
