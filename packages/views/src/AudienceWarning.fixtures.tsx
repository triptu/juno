import { defineFixtures, fixture } from '@juno/ui'
import { AudienceWarning } from './AudienceWarning'

export default defineFixtures(
  AudienceWarning,
  {
    Message: {
      'public-channel': fixture({ message: 'This reads like hiring or people detail. eng is a public channel.' }),
    },
  },
  { width: 752 },
)
