import { defineFixtures, fixture } from '@juno/ui'
import { AppInfoView } from './AppInfoView'
import { UpdateSettings, type UpdateSettingsProps } from './UpdateSettings'

const noop = () => {}
const base: UpdateSettingsProps = {
  build: <AppInfoView line="Juno 0.1.14 on darwin, Electron 44.7.0" compact />,
  available: true,
  enabled: false,
  status: null,
  whatsNew: null,
  onChange: noop,
  onCheck: noop,
  onRestart: noop,
  onDownload: noop,
  onCopyDetails: noop,
  onWhatsNew: noop,
}
const notes = [
  { version: '0.3.0', date: '2026-11-02', lines: ['Peek shows the last reply.', 'Fixed a crash on sign out.'] },
  { version: '0.2.0', date: '2026-10-20', lines: ['Updates come from the releases repository.'] },
  { version: '0.1.0', date: '2026-09-18', lines: ['Juno starts with a calm topic list.', 'Open a thread as its own topic.'] },
]
export default defineFixtures(UpdateSettings, {
  Updates: {
    off: fixture(base),
    on: fixture({ ...base, enabled: true }),
    ready: fixture({ ...base, enabled: true, status: { kind: 'restart', version: '0.1.15' } }),
    available: fixture({ ...base, enabled: true, status: { kind: 'download', version: '0.1.15', download: 'none' } }),
    downloading: fixture({ ...base, enabled: true, status: { kind: 'download', version: '0.1.15', download: 'downloading', progress: 0.42 } }),
    failed: fixture({ ...base, enabled: true, status: { kind: 'download', version: '0.1.15', download: 'failed' } }),
    unavailable: fixture({ ...base, available: false }),
  },
  'Check for updates': {
    checking: fixture({ ...base, status: { kind: 'checking' } }),
    current: fixture({ ...base, status: { kind: 'current' } }),
    'downloading, no size': fixture({ ...base, status: { kind: 'download', version: '0.1.15', download: 'downloading' } }),
    error: fixture({ ...base, status: { kind: 'failed' } }),
  },
  "What's new": {
    recent: fixture({ ...base, enabled: true, status: { kind: 'download', version: '0.3.0', download: 'none' }, whatsNew: { for: 'installed', notes: { installedVersion: '0.2.0', availableVersions: ['0.3.0'], entries: notes } } }),
    update: fixture({ ...base, enabled: true, status: { kind: 'download', version: '0.3.0', download: 'none' }, whatsNew: { for: 'update', notes: { installedVersion: '0.2.0', availableVersions: ['0.3.0'], entries: notes } } }),
    loading: fixture({ ...base, whatsNew: { for: 'installed', notes: 'loading' } }),
    failed: fixture({ ...base, whatsNew: { for: 'installed', notes: 'failed' } }),
  },
}, { width: 600, height: 300 })
