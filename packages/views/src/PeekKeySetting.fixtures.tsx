import { defineFixtures, fixture } from '@juno/ui'
import { PeekKeySetting } from './PeekKeySetting'

const noop = () => {}

export default defineFixtures(
  PeekKeySetting,
  {
    Key: {
      option: fixture({ value: 'option', onChange: noop }),
      space: fixture({ value: 'space', onChange: noop }),
    },
  },
  { width: 300 },
)
