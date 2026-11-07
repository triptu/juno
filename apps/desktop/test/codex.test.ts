/**
 * Main's local Codex (`src/main/codex.ts`): one `codex login` at a time,
 * whatever Settings asks, and none left running when the app quits. The
 * executable is a script standing in for Codex, so a real process is run.
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'bun:test'
import { eventually } from '@juno/testing/eventually'
import { codexHome } from '../src/main/codex'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A Codex that is installed and signed out: `login status` says so, and `login` waits for the browser until it is killed. */
async function fakeCodex(): Promise<{ readonly agentDir: string; readonly executable: string; readonly calls: () => Promise<string[]> }> {
  const dir = await mkdtemp(join(tmpdir(), 'juno-codex-'))
  dirs.push(dir)
  const executable = join(dir, 'codex')
  const log = join(dir, 'calls')
  await writeFile(executable, `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$2" = "status" ]; then echo "Not logged in"; exit 0; fi\nexec sleep 600\n`)
  await chmod(executable, 0o755)
  return {
    agentDir: join(dir, 'agent'),
    executable,
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter((line) => line !== ''),
  }
}

it('two sign-in clicks run one codex login, and quitting ends it', async () => {
  const codex = await fakeCodex()
  const home = codexHome(codex.agentDir, codex.executable)
  const first = home.signIn()
  const second = home.signIn()
  await eventually(async () => expect(await codex.calls()).toContain('login'), { timeout: 5_000 })
  home.stop()
  expect(await first).toBe('signedOut')
  expect(await second).toBe('signedOut')
  expect((await codex.calls()).filter((line) => line === 'login')).toHaveLength(1)
})
