import { defineFixtures, fixture } from '@juno/ui'
import { AppInfoView } from './AppInfoView'

// The three lines App.tsx passes: the build, while it loads, and when the read fails.
export default defineFixtures(AppInfoView, {
  Data: {
    default: fixture({ line: 'Juno 0.1.0 on darwin, Electron 44.7.0' }),
    loading: fixture({ line: 'Loading app info' }),
    failed: fixture({ line: 'Could not read app info' }),
  },
})
