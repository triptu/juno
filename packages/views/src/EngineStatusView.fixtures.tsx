import { defineFixtures, fixture } from '@juno/ui'
import { EngineStatusView } from './EngineStatusView'

export default defineFixtures(EngineStatusView, {
  connecting: fixture({ line: 'Connecting to engine', onPing: () => {} }),
  live: fixture({ line: 'Engine live', onPing: () => {} }),
  'live-with-pong': fixture({ line: 'Engine live', pong: 'Pong 3', onPing: () => {} }),
  'catching-up': fixture({ line: 'Engine catching up, 12 of 40', onPing: () => {} }),
  unreachable: fixture({ line: 'Engine unreachable', pong: 'Ping failed', onPing: () => {} }),
})
