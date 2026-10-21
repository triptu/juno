import { defineFixtures, fixture } from '@juno/ui'
import { EngineNotice, EngineStatusView, SyncProgress } from './EngineStatusView'

const onPing = () => {}

// The lines the container draws for each connection and engine phase
// (friendly-layer.md section 7). The view only shows them. The container
// does not yet produce the offline, rate-limited and catching-up copy below;
// until it does, those lines read "Engine offline" and so on.
export default defineFixtures(EngineStatusView, {
  Connection: {
    connecting: fixture({ line: 'Connecting to engine', onPing }),
    restarting: fixture({ line: 'Engine restarting', onPing }),
    failed: fixture({ line: 'Engine failed', onPing }),
    unreachable: fixture({ line: 'Engine unreachable', pong: 'Ping failed', onPing }),
  },
  Phase: {
    'first-run': fixture({ line: 'Engine ready to sign in', onPing }),
    booting: fixture({ line: 'Engine starting', onPing }),
    'catching-up': fixture({ line: 'Catching up, 12 of 40 channels', onPing }),
    live: fixture({ line: 'Engine live', onPing }),
    offline: fixture({ line: "You're offline. Juno shows what it has and catches up when you're back.", onPing }),
    'rate-limited': fixture({ line: 'Slack asked us to slow down. Juno will catch up in a minute.', onPing }),
    failed: fixture({ line: 'Engine sync failed', onPing }),
    'session-expired': fixture({ line: 'Engine session expired', onPing }),
  },
  Ping: {
    answered: fixture({ line: 'Engine live', pong: 'Pong 3', onPing }),
  },
})

const onRestart = () => {}
const onCopyLog = () => {}

// The fixed secondary line in the sidebar header, as the Sidebar container draws it.
export const engineNoticeFixtures = defineFixtures(
  EngineNotice,
  {
    Sync: {
      offline: fixture({ kind: 'offline' }),
      failed: fixture({ kind: 'failed', reason: "Slack sent data Juno can't read.", onCopyLog }),
      'failed without reason': fixture({ kind: 'failed', onCopyLog }),
      'rate-limited': fixture({ kind: 'rate-limited' }),
      stopped: fixture({ kind: 'stopped', onRestart }),
    },
  },
  { width: 384, padded: false, surface: 'subtle' },
)

// The first sync's progress, in the same place, until the sidebar is complete.
export const syncProgressFixtures = defineFixtures(
  SyncProgress,
  {
    'First sync': {
      listing: fixture({}),
      started: fixture({ done: 0, total: 143 }),
      'part way': fixture({ done: 30, total: 143 }),
      done: fixture({ done: 143, total: 143 }),
    },
  },
  { width: 384, padded: false, surface: 'subtle' },
)
