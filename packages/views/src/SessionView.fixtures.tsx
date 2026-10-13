import { defineFixtures, fixture } from '@juno/ui'
import { SessionView } from './SessionView'

export default defineFixtures(SessionView, {
  Account: {
    ready: fixture({ teamName: 'Juno Fake', userName: 'tushar', onSignOut: () => {} }),
    grid: fixture({ teamName: 'Juno Fake', userName: 'tushar', enterpriseName: 'Juno Fake Org', onSignOut: () => {} }),
  },
  'Sign out': {
    'signing-out': fixture({ teamName: 'Juno Fake', userName: 'tushar', signingOut: true, onSignOut: () => {} }),
  },
})
