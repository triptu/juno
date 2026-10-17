import { defineFixtures, fixture } from '@juno/ui'
import { AttachmentChips } from './AttachmentChips'
import { chips } from './AttachmentChips.fixtures'
import { AttachmentNote } from './AttachmentNote'

const NOTE = 'Juno reads text only. Pick a person or channel to send files.'
const noop = () => {}

export default defineFixtures(
  AttachmentNote,
  {
    State: {
      'juno-chosen': fixture({ chips: <AttachmentChips files={[chips.pdf, chips.image]} onRemove={noop} />, note: NOTE }),
    },
  },
  { width: 560 },
)
