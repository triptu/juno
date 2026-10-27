import { expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateTestEnvironment } from '../src/main/testEnvironment'

const switches = {
  JUNO_E2E: '1', JUNO_AI: 'fake', JUNO_AGENT_CRASH_AT: 'inbox.committed',
  JUNO_E2E_FAST_TIMING: '1', JUNO_FAKE_SLACK_URL: 'http://127.0.0.1:1',
  JUNO_TEST_FULLFSYNC: '0', JUNO_SLACK_APP_DIR: '/fake', JUNO_SLACK_SAFE_STORAGE_PASSWORD: 'fake',
  JUNO_E2E_OPENROUTER_KEY: 'fake', JUNO_FAKE_OPENROUTER_URL: 'http://127.0.0.1:1',
}

it('a packaged-mode process ignores test switches on the default profile and its aliases', () => {
  const root = mkdtempSync(join(tmpdir(), 'juno-env-'))
  try {
    const profile = join(root, 'Juno')
    mkdirSync(profile)
    symlinkSync(profile, join(root, 'alias'))
    for (const userData of [undefined, '', profile, join(profile, '..', 'Juno'), join(root, 'alias')]) {
      const env = { ...process.env, ...switches, JUNO_USER_DATA: userData, JUNO_AGENT_CODEMODE: '1' }
      if (userData === undefined) delete env.JUNO_USER_DATA
      const result = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'fixtures/packagedEnvironment.ts'), profile], { env, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      const observed = JSON.parse(result.stdout)
      expect(observed).toEqual({ e2e: false, ai: 'live', backoff: 1000, fullfsync: 1, checkpoint: 1, codemode: '1', testEnv: [] })
    }
    // A not-yet-created default profile reached through a symlink is also protected.
    symlinkSync(root, join(root, 'parent-alias'))
    const env = { ...switches, JUNO_USER_DATA: join(root, 'parent-alias', 'new') }
    gateTestEnvironment({ isPackaged: true, defaultUserData: join(root, 'new'), env })
    expect(env.JUNO_E2E).toBeUndefined()
    for (const isPackaged of [false, true]) {
      const allowed = { ...switches, JUNO_USER_DATA: join(root, 'smoke') }
      gateTestEnvironment({ isPackaged, defaultUserData: profile, env: allowed })
      expect(allowed).toEqual({ ...switches, JUNO_USER_DATA: join(root, 'smoke') })
    }
    const noOptIn = { ...switches, JUNO_E2E: '0', JUNO_USER_DATA: join(root, 'smoke') }
    gateTestEnvironment({ isPackaged: true, defaultUserData: profile, env: noOptIn })
    expect(noOptIn.JUNO_AGENT_CRASH_AT).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
