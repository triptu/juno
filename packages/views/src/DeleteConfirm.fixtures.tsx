import { defineFixtures, fixture } from '@juno/ui'
import { DeleteConfirm } from './DeleteConfirm'

const noop = () => {}

// Delete… on your own message asks once, at the message's top right (ADR 0010).
export default defineFixtures(DeleteConfirm, {
  Confirm: {
    'confirm-delete': fixture({ onConfirm: noop, onCancel: noop }),
    'hover-delete': fixture({ onConfirm: noop, onCancel: noop }, { hover: 'button:last-of-type' }),
  },
})
