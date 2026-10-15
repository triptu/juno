import { defineFixtures, fixture } from '@juno/ui'
import { UpdateSettings, type UpdateSettingsProps } from './UpdateSettings'

const base: UpdateSettingsProps = { available: true, enabled: false, version: null, onChange: () => {}, onRestart: () => {} }
export default defineFixtures(UpdateSettings, {
  Updates: {
    off: fixture(base),
    on: fixture({ ...base, enabled: true }),
    ready: fixture({ ...base, enabled: true, version: '0.2.0' }),
    unavailable: fixture({ ...base, available: false }),
  },
}, { width: 600, height: 150 })
