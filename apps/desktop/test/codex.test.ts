/**
 * Main's local Codex (`src/main/codex.ts`): one `codex login` at a time,
 * whatever Settings asks, and none left running when the app quits. The
 * executable is a script standing in for Codex, so a real process is run.
 */
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { eventually } from '@juno/testing/eventually'
import { codexHome } from '../src/main/codex'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

interface FakeCodexOptions {
  /** `login status` answers only once `releaseStatus` is called, as a slow Codex would. */
  readonly holdStatus?: boolean
  /** `login` exits at once instead of waiting for the browser. */
  readonly loginExits?: boolean
}

/** A Codex that is installed and signed out: `login status` says so, and `login` waits for the browser until it is killed. */
async function fakeCodex({ holdStatus = false, loginExits = false }: FakeCodexOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'juno-codex-'))
  dirs.push(dir)
  const executable = join(dir, 'codex')
  const log = join(dir, 'calls')
  const gate = join(dir, 'status-released')
  const wait = holdStatus ? `while [ ! -e "${gate}" ]; do sleep 0.02; done\n` : ''
  const login = loginExits ? 'exit 0' : 'exec sleep 600'
  await writeFile(executable, `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$2" = "status" ]; then ${wait}echo "Not logged in"; exit 0; fi\n${login}\n`)
  await chmod(executable, 0o755)
  return {
    agentDir: join(dir, 'agent'),
    executable,
    releaseStatus: () => writeFile(gate, ''),
    ran: () => {
      let lines = ''
      try {
        lines = readFileSync(log, 'utf8')
      } catch {
        lines = ''
      }
      return lines.split('\n').filter((line) => line !== '')
    },
  }
}

it('two sign-in clicks run one codex login, and quitting ends it', async () => {
  const codex = await fakeCodex()
  const home = codexHome(codex.agentDir, () => codex.executable)
  const first = home.signIn()
  const second = home.signIn()
  await eventually(() => expect(codex.ran()).toContain('login'), { timeout: 5_000 })
  home.stop()
  expect(await first).toBe('signedOut')
  expect(await second).toBe('signedOut')
  // Both sign-ins have ended, so the child has exited and the log is final.
  expect(codex.ran().filter((line) => line === 'login')).toHaveLength(1)
})

it('quitting while the sign-in is still checking the status starts no codex login', async () => {
  const codex = await fakeCodex({ holdStatus: true, loginExits: true })
  const home = codexHome(codex.agentDir, () => codex.executable)
  const signingIn = home.signIn()
  await eventually(() => expect(codex.ran()).toContain('login status'), { timeout: 5_000 })
  // The app quits while `codex login status` has not answered yet.
  home.stop()
  await codex.releaseStatus()
  expect(await signingIn).toBe('signedOut')
  expect(codex.ran()).not.toContain('login')
})
