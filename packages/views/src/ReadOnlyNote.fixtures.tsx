import { defineFixtures, fixture } from '@juno/ui'
import { ReadOnlyNote } from './ReadOnlyNote'

const noop = () => {}

// In the composer's place (SPEC 7): a deactivated person's DM, a public channel's preview with Join channel, and a private channel you left.
export default defineFixtures(ReadOnlyNote, {
  Note: {
    deactivated: fixture({ text: 'Maya Chen’s account is deactivated. You can read this conversation but not reply.' }),
    preview: fixture({ text: 'You’re not in #design.', action: { label: 'Join channel', onAction: noop } }),
    left: fixture({ text: 'You left #leadership.' }),
  },
})
