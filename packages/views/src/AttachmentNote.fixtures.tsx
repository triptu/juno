import { chatCopy } from '@juno/agent-contract'
import { defineFixtures, fixture } from '@juno/ui'
import { AttachmentChips } from './AttachmentChips'
import { chips } from './AttachmentChips.fixtures'
import { AttachmentNote } from './AttachmentNote'

const noop = () => {}

export default defineFixtures(
  AttachmentNote,
  {
    State: {
      // Juno takes the image; the PDF stays for a person or channel.
      'juno-chosen': fixture({ chips: <AttachmentChips files={[chips.pdf, chips.image]} onRemove={noop} />, note: chatCopy.composer.filesLeft.other }),
      'model-cannot-read': fixture({ chips: <AttachmentChips files={[chips.image]} onRemove={noop} />, note: chatCopy.composer.filesLeft.images }),
      'both-reasons': fixture({ chips: <AttachmentChips files={[chips.pdf, chips.image]} onRemove={noop} />, note: `${chatCopy.composer.filesLeft.images} ${chatCopy.composer.filesLeft.other}` }),
    },
  },
  { width: 560 },
)
