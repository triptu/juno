import { defineFixtures, fixture } from '@juno/ui'
import { BackupSection, type BackupSectionProps } from './BackupSections'
import { NOW, settings, settingsTrouble } from './fixtures'

const noop = () => {}
const base: BackupSectionProps = { page: settings, now: NOW, onBackupFolder: noop, onExportPhrase: noop }

export default defineFixtures(
  BackupSection,
  {
    Backup: {
      'backed-up': fixture<BackupSectionProps>(base),
      // A first start: nothing written yet and no phrase.
      'no-backup-yet': fixture<BackupSectionProps>({ ...base, page: settingsTrouble }),
      'on-a-shared-drive': fixture<BackupSectionProps>({ ...base, page: { ...settings, backupFolder: '/Users/maya/Library/CloudStorage/Dropbox/Juno backup', lastBackupAt: NOW - 60_000 } }),
      choosing: fixture<BackupSectionProps>({ ...base, backupBusy: 'folder' }),
      'folder-refused': fixture<BackupSectionProps>({ ...base, backupError: { row: 'folder', message: "Juno can't write to that folder. Choose another one." } }),
      'export-failed': fixture<BackupSectionProps>({ ...base, backupError: { row: 'phrase', message: 'Juno could not reach the keychain. Try again.' } }),
    },
  },
  { width: 720, padded: true },
)
