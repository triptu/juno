import { defineFixtures, fixture } from '@juno/ui'
import { WhyPopover } from './WhyPopover'

const noop = () => {}
const at = { x: 24, y: 16 }

export default defineFixtures(
  WhyPopover,
  {
    Reason: {
      setting: fixture({ at, title: "Didn't notify you", reason: '#design-review is set to Never.', action: { label: 'Change', onAction: noop }, onClose: noop }),
      juno: fixture({ at, title: 'Notified you at 13:42', reason: 'Juno: Dev asks you to approve the release before 2pm.', action: { label: 'Tell Juno', onAction: noop }, onClose: noop }),
      'no-action': fixture({ at, title: 'In the 9am summary', reason: 'Outside your notification hours. Juno: asks you to decide before 2pm.', onClose: noop }),
    },
  },
  { width: 380, height: 200 },
)
