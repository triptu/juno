import { defineFixtures, fixture } from '@juno/ui'
import { NewTabSetting } from './NewTabSetting'

const noop = () => {}

export default defineFixtures(
  NewTabSetting,
  {
    Page: {
      'new-chat': fixture({ value: 'newChat', onChange: noop }),
      home: fixture({ value: 'home', onChange: noop }),
    },
  },
  { width: 300 },
)
