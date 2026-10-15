import { defineFixtures, fixture } from '@juno/ui'
import { ThisMacSection, type ThisMacSectionProps } from './BackupSections'
import { settings, settingsTrouble } from './fixtures'

const noop = () => {}
const base: ThisMacSectionProps = { page: settings, onMove: noop, onRestore: noop, onStopJob: noop }
const owner = (ownership: ThisMacSectionProps['page']['ownership']) => fixture<ThisMacSectionProps>({ ...base, page: { ...settings, ownership } })

export default defineFixtures(
  ThisMacSection,
  {
    'This Mac': {
      active: fixture<ThisMacSectionProps>(base),
      // Move pressed: released, the final backup still being written.
      moving: owner({ _tag: 'released', epoch: 3 }),
      moved: owner({ _tag: 'released', epoch: 3, moveCode: '7KQ2-M9XA' }),
      'other-mac': owner({ _tag: 'released', epoch: 3, deviceName: 'Maya’s MacBook Air' }),
      recovery: owner({ _tag: 'recovery', pending: 2 }),
      'removal-pending': fixture<ThisMacSectionProps>({ ...base, page: settingsTrouble }),
    },
  },
  { width: 720, padded: true },
)
