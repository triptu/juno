import { defineFixtures, fixture } from '@juno/ui'
import { AppInfoView } from './AppInfoView'

export default defineFixtures(AppInfoView, {
  default: fixture({ line: 'Juno 0.1.0 on darwin, Electron 44.7.0' }),
  loading: fixture({ line: 'Loading app info' }),
})
