import { defineFixtures, fixture } from '@juno/ui'
import { UpdateSettings, type UpdateSettingsProps } from './UpdateSettings'

const noop = () => {}
const base: UpdateSettingsProps = { available: true, enabled: false, offer: null, whatsNew: null, onChange: noop, onRestart: noop, onDownload: noop, onWhatsNew: noop }
const notes = [
  { version: '0.3.0', date: '2026-11-02', lines: ['Peek shows the last reply.', 'Fixed a crash on sign out.'] },
  { version: '0.2.0', date: '2026-10-20', lines: ['Updates come from the releases repository.'] },
]
export default defineFixtures(UpdateSettings, {
  Updates: {
    off: fixture(base),
    on: fixture({ ...base, enabled: true }),
    ready: fixture({ ...base, enabled: true, offer: { kind: 'restart', version: '0.2.0' } }),
    available: fixture({ ...base, enabled: true, offer: { kind: 'download', version: '0.2.0', download: 'none' } }),
    downloading: fixture({ ...base, enabled: true, offer: { kind: 'download', version: '0.2.0', download: 'downloading' } }),
    failed: fixture({ ...base, enabled: true, offer: { kind: 'download', version: '0.2.0', download: 'failed' } }),
    unavailable: fixture({ ...base, available: false }),
  },
  "What's new": {
    update: fixture({ ...base, enabled: true, offer: { kind: 'download', version: '0.3.0', download: 'none' }, whatsNew: { for: 'update', notes } }),
    loading: fixture({ ...base, whatsNew: { for: 'installed', notes: 'loading' } }),
    failed: fixture({ ...base, whatsNew: { for: 'installed', notes: 'failed' } }),
  },
}, { width: 600, height: 260 })
