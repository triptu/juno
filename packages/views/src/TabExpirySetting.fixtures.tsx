import { defineFixtures, fixture } from '@juno/ui'
import { TabExpirySetting } from './TabExpirySetting'

const noop = () => {}

export default defineFixtures(
  TabExpirySetting,
  {
    Page: {
      'one-day': fixture({ value: '1d', onChange: noop }),
      never: fixture({ value: 'never', onChange: noop }),
    },
  },
  { width: 300 },
)
