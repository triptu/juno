import { DatabaseSync } from 'node:sqlite'
import { gateTestEnvironment } from '../../src/main/testEnvironment'

gateTestEnvironment({ isPackaged: true, defaultUserData: process.argv[2]!, env: process.env })
const { crashPoint } = await import('../../../../packages/agent/src/runtime/crash')
const { durablePragmas } = await import('../../../../packages/agent/src/store/durability')
const { restartBackoff } = await import('../../src/main/restartBackoff')
crashPoint('inbox.committed')
// Even restoring the old switch after the gate cannot change durability.
process.env.JUNO_TEST_FULLFSYNC = '0'
const db = new DatabaseSync(':memory:')
for (const pragma of durablePragmas()) db.exec(pragma)
delete process.env.JUNO_TEST_FULLFSYNC
console.log(JSON.stringify({
  e2e: process.env.JUNO_E2E === '1', ai: process.env.JUNO_AI === 'fake' ? 'fake' : 'live',
  backoff: restartBackoff(0), fullfsync: db.prepare('PRAGMA fullfsync').get()!.fullfsync,
  checkpoint: db.prepare('PRAGMA checkpoint_fullfsync').get()!.checkpoint_fullfsync,
  codemode: process.env.JUNO_AGENT_CODEMODE,
  testEnv: Object.keys(process.env).filter(name => name in {
    JUNO_E2E: 1, JUNO_AI: 1, JUNO_AGENT_CRASH_AT: 1, JUNO_E2E_FAST_TIMING: 1,
    JUNO_FAKE_SLACK_URL: 1, JUNO_TEST_FULLFSYNC: 1, JUNO_SLACK_APP_DIR: 1,
    JUNO_SLACK_SAFE_STORAGE_PASSWORD: 1, JUNO_E2E_OPENROUTER_KEY: 1, JUNO_FAKE_OPENROUTER_URL: 1,
  }),
}))
db.close()
