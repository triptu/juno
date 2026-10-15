import * as stylex from '@stylexjs/stylex'
import { defineFixtures, Page, scene, type Fixture } from '@juno/ui'
import { BackupSection, type BackupSectionProps } from './BackupSections'
import { NOW, settings, settingsTrouble } from './fixtures'

const noop = () => {}
const base: BackupSectionProps = { page: settings, now: NOW, onBackupFolder: noop, onExportPhrase: noop }

// The frame sizes a lone component to its content; the page fills the frame as it fills its tab.
const column = stylex.create({ fill: { width: '100%' } })

/** In the settings column, at the width Settings gives it. */
const inPage = (props: Partial<BackupSectionProps> = {}): Fixture<BackupSectionProps> =>
  scene(() => (
    <div {...stylex.props(column.fill)}>
      <Page width="settings">
        <BackupSection {...base} {...props} />
      </Page>
    </div>
  ))

export default defineFixtures(
  BackupSection,
  {
    Backup: {
      'backed-up': inPage(),
      // A first start: nothing written yet and no phrase.
      'no-backup-yet': inPage({ page: settingsTrouble }),
      'on-a-shared-drive': inPage({ page: { ...settings, backupFolder: '/Users/maya/Library/CloudStorage/Dropbox/Juno backup', lastBackupAt: NOW - 60_000 } }),
      'long-path': inPage({ page: { ...settings, backupFolder: '/Users/maya/Library/CloudStorage/Dropbox/Workspace archives/Shared folders/Desktop clients/Juno backup' } }),
      exporting: inPage({ backupBusy: 'phrase' }),
      choosing: inPage({ backupBusy: 'folder' }),
      'folder-refused': inPage({ backupError: { row: 'folder', message: "Juno can't write to that folder. Choose another one." } }),
      'export-failed': inPage({ backupError: { row: 'phrase', message: 'Juno could not reach the keychain. Try again.' } }),
    },
  },
  { width: 960, padded: false },
)
