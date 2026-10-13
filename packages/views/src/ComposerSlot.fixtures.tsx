import { defineFixtures, fixture } from '@juno/ui'
import { ComposerSlot } from './ComposerSlot'

export default defineFixtures(
  ComposerSlot,
  {
    Placeholder: {
      reply: fixture({ placeholder: 'Reply' }),
      'message-channel': fixture({ placeholder: 'Message #eng' }),
      'message-person': fixture({ placeholder: 'Message Maya Chen' }),
    },
  },
  { width: 816, padded: false },
)
