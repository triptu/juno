import { defineFixtures, fixture } from '@juno/ui'
import { NewDivider } from './NewDivider'

export default defineFixtures(
  NewDivider,
  {
    Count: {
      one: fixture({ count: 1 }),
      three: fixture({ count: 3 }),
      'many': fixture({ count: 128 }),
    },
  },
  { width: 480 },
)
