/**
 * `bun test --preload` for `JUNO_DOM_PROFILE=1` (`scripts/dom-tests.mjs`):
 * a CPU profile of the Bun side (test, fake, renderer) through the
 * inspector, since `bun test` ignores `--cpu-prof`, written with the hosts'
 * profiles to `test-results/dom-profile/` when the run ends.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector'
import { join } from 'node:path'
import { afterAll } from 'bun:test'
import { closeHostPool } from './app'

const dir = join(__dirname, '../test-results/dom-profile')
const session = new Session()
session.connect()
session.post('Profiler.enable')
session.post('Profiler.setSamplingInterval', { interval: 500 })
session.post('Profiler.start')

afterAll(async () => {
  const profile = await new Promise<unknown>((done, fail) => session.post('Profiler.stop', (error, result) => (error === null ? done((result as { profile: unknown }).profile) : fail(error))))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `bun-${process.pid}.cpuprofile`), JSON.stringify(profile))
  // A host writes its profile when it exits.
  await closeHostPool()
})
