// Runs the DOM lane (apps/desktop/dom/README.md): builds its renderer bundle
// and host into apps/desktop/dom/dist through build-cached, then runs its test
// files in one `bun test --parallel --no-isolate` from apps/desktop, in a
// shuffled order whose seed it prints, as `bun run test` does.
//
//   bun run test:dom                                   every file
//   bun run test:dom --files apps/desktop/dom/send.test.ts   those files
//   bun run test:dom --seed <n>                        repeat an order
//
// Workers: JUNO_DOM_WORKERS, else JUNO_TEST_WORKERS (one per allocated thread
// on the runner), else half this machine's threads. A worker keeps its renderer
// script and its pool of loaded hosts for the whole run; the synced snapshot is
// shared by every worker. Other arguments go to `bun test`.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forwardSignals } from './remote/children.mjs'
import { bunTestEnv, takeSeed } from './unit.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const app = join(root, 'apps/desktop')
/** The DOM lane's limit on one test's time (packages/testing/src/limits.ts), loaded only to run, as in `unit.mjs`. */
async function domTimeout() {
  const { DOM_LIMIT_MS, limitScale } = await import('../packages/testing/src/limits.ts')
  return DOM_LIMIT_MS * limitScale()
}

/** Whether a repo path is a DOM lane test file. */
export const isDomTest = (file) => /^apps\/desktop\/dom\/(?!dist\/)[^.][^]*\.test\.ts$/.test(file) && !file.split('/').includes('..')

/** The `bun test` arguments, relative to apps/desktop, and the order seed. */
export function domCommand(given, { workers = defaultWorkers(), exists = (file) => existsSync(join(root, file)), timeout } = {}) {
  const { seed, rest } = takeSeed(given)
  const at = rest.indexOf('--files')
  const files = at === -1 ? [] : [...new Set(rest.slice(at + 1))]
  const extra = at === -1 ? rest : rest.slice(0, at)
  if (at !== -1 && files.length === 0) throw new Error('--files needs at least one repository test path')
  for (const file of files) if (!isDomTest(file) || !exists(file)) throw new Error(`Not a DOM lane test file: ${file}`)
  const paths = files.length === 0 ? ['./dom'] : files.map((file) => `./${file.slice('apps/desktop/'.length)}`)
  const count = files.length === 0 ? workers : Math.min(workers, files.length)
  return { seed, args: ['test', `--parallel=${count}`, '--no-isolate', `--seed=${seed}`, ...(timeout === undefined ? [] : [`--timeout=${timeout}`]), ...extra, ...paths] }
}

function defaultWorkers() {
  const workers = Number(process.env.JUNO_DOM_WORKERS ?? process.env.JUNO_TEST_WORKERS ?? Math.max(1, Math.floor(availableParallelism() / 2)))
  if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('JUNO_DOM_WORKERS must be a positive integer')
  return workers
}

if (import.meta.main) {
  const { seed, args } = domCommand(process.argv.slice(2), { timeout: await domTimeout() })
  const built = spawnSync(process.execPath, [join(root, 'scripts/build-cached.mjs'), 'dom/dist', 'bun', 'run', 'build:dom'], { cwd: app, stdio: 'inherit' })
  if (built.status !== 0) process.exit(built.status ?? 1)
  console.log(`dom: test order seed ${seed}; \`bun run test:dom --seed ${seed}\` repeats it`)
  // JUNO_DOM_PROFILE=1: one process, no workers, a CPU profile of the Bun side and each host in test-results/dom-profile/.
  const profile = process.env.JUNO_DOM_PROFILE === '1'
  const dir = join(app, 'test-results/dom-profile')
  const command = profile ? [args[0], '--preload=./dom/profile.ts', ...args.slice(1).filter((arg) => !arg.startsWith('--parallel'))] : args
  const child = spawn('bun', command, { cwd: app, stdio: 'inherit', env: profile ? { ...bunTestEnv(), JUNO_E2E_HOST_PROFILE: join(dir, 'host') } : bunTestEnv() })
  forwardSignals(new Set([child]))
  child.on('error', (error) => console.error(error.message))
  child.on('close', (code, signal) => { process.exitCode = signal ? 130 : code ?? 1 })
}
