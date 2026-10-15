import { defineFixtures, Page, scene, type Fixture } from '@juno/ui'
import { BackupSection, type BackupSectionProps } from './BackupSections'
import { NOW, settings, settingsTrouble } from './fixtures'

const noop = () => {}
const base: BackupSectionProps = { page: settings, now: NOW, onBackupFolder: noop, onExportPhrase: noop }

/** In the settings column, at the width Settings › Juno gives it. */
const inPage = (props: Partial<BackupSectionProps> = {}): Fixture<BackupSectionProps> =>
  scene(() => (
    <Page width="settings">
      <BackupSection {...base} {...props} />
    </Page>
  ))

export default defineFixtures(
  BackupSection,
  {
    Backup: {
      'backed-up': inPage(),
      // A first start: nothing written yet and no phrase.
      'no-backup-yet': inPage({ page: settingsTrouble }),
      'on-a-shared-drive': inPage({ page: { ...settings, backupFolder: '/Users/maya/Library/CloudStorage/Dropbox/Juno backup', lastBackupAt: NOW - 60_000 } }),
      choosing: inPage({ backupBusy: 'folder' }),
      'folder-refused': inPage({ backupError: { row: 'folder', message: "Juno can't write to that folder. Choose another one." } }),
      'export-failed': inPage({ backupError: { row: 'phrase', message: 'Juno could not reach the keychain. Try again.' } }),
    },
  },
  { width: 960, padded: false },
)
