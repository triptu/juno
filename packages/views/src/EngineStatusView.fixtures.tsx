import { defineFixtures, fixture } from '@juno/ui'
import { EngineStatusView } from './EngineStatusView'

// The lines a container produces for each engine phase (friendly-layer.md
// section 7). The view only draws them.
export default defineFixtures(EngineStatusView, {
  connecting: fixture({ line: 'Connecting to engine', onPing: () => {} }),
  live: fixture({ line: 'Engine live', onPing: () => {} }),
  'live-with-pong': fixture({ line: 'Engine live', pong: 'Pong 3', onPing: () => {} }),
  'catching-up': fixture({ line: 'Catching up, 12 of 40 channels', onPing: () => {} }),
  offline: fixture({ line: "You're offline. Juno shows what it has and catches up when you're back.", onPing: () => {} }),
  'rate-limited': fixture({ line: 'Slack asked us to slow down. Juno will catch up in a minute.', onPing: () => {} }),
  unreachable: fixture({ line: 'Engine unreachable', pong: 'Ping failed', onPing: () => {} }),
})
