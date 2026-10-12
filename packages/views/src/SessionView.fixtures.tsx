import { defineFixtures, fixture } from '@juno/ui'
import { SessionView } from './SessionView'

export default defineFixtures(SessionView, {
  ready: fixture({ teamName: 'Juno Fake', userName: 'alex', onSignOut: () => {} }),
  grid: fixture({ teamName: 'Juno Fake', userName: 'alex', enterpriseName: 'Juno Fake Org', onSignOut: () => {} }),
  'signing-out': fixture({ teamName: 'Juno Fake', userName: 'alex', signingOut: true, onSignOut: () => {} }),
})
