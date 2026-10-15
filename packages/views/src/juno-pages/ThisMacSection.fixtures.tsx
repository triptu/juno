import { defineFixtures, Page, scene, type Fixture } from '@juno/ui'
import { ThisMacSection, type ThisMacSectionProps } from './BackupSections'
import { settings, settingsTrouble } from './fixtures'

const noop = () => {}
const base: ThisMacSectionProps = { page: settings, onMove: noop, onRestore: noop, onStopJob: noop }

/** In the settings column, at the width Settings › Juno gives it. */
const inPage = (page: ThisMacSectionProps['page']): Fixture<ThisMacSectionProps> =>
  scene(() => (
    <Page width="settings">
      <ThisMacSection {...base} page={page} />
    </Page>
  ))
const owner = (ownership: ThisMacSectionProps['page']['ownership']) => inPage({ ...settings, ownership })

export default defineFixtures(
  ThisMacSection,
  {
    'This Mac': {
      active: inPage(settings),
      // Move pressed: released, the final backup still being written.
      moving: owner({ _tag: 'released', epoch: 3 }),
      moved: owner({ _tag: 'released', epoch: 3, moveCode: '7KQ2-M9XA' }),
      'other-mac': owner({ _tag: 'released', epoch: 3, deviceName: 'Maya’s MacBook Air' }),
      recovery: owner({ _tag: 'recovery', pending: 2 }),
      'removal-pending': inPage(settingsTrouble),
    },
  },
  { width: 960, padded: false },
)
