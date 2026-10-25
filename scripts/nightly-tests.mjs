// Runs the nightly tier (scripts/test-areas.mjs, NIGHTLY_AREAS): the desktop
// e2e tests tagged @nightly, in the browser and Electron projects, and the DOM
// lane files that hold a nightly test, whole. A normal full run skips these
// tests; a nightly full run keeps them in its own suites; a release runs the
// files its changes reach since they last passed (scripts/nightly-reach.mjs).
//
//   bun run test:nightly                                    every nightly file
//   bun run test:nightly e2e/huddle.spec.ts dom/huddle.test.ts   those files (relative to apps/desktop, or repo paths)
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDomTest } from './dom-tests.mjs'
import { forwardSignals } from './remote/children.mjs'
import { holdsNightly } from './test-areas.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Whether a repo path is a desktop e2e spec the browser or Electron project runs. */
export const isDesktopSpec = (file) => /^apps\/desktop\/e2e\/.*\.spec\.ts$/.test(file) && !/perf\.spec|screens\.spec|\/screens\//.test(file)

/** The repo paths of the test files that hold a nightly test, read through `read`. */
export function nightlyFiles(files, read) {
  return files.filter((file) => (isDesktopSpec(file) || isDomTest(file)) && holdsNightly(read(file)))
}

/** A path relative to apps/desktop or the repo, as a repo path. */
export const repoPath = (file) => (file.startsWith('apps/desktop/') ? file : `apps/desktop/${file.replace(/^\.\//, '')}`)

if (import.meta.main) {
  const given = process.argv.slice(2).map(repoPath)
  const tracked = spawnSync('git', ['ls-files', '--', 'apps/desktop/e2e', 'apps/desktop/dom'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
  const files = given.length > 0 ? given : nightlyFiles(tracked, (file) => readFileSync(join(root, file), 'utf8'))
  for (const file of files) if (!isDesktopSpec(file) && !isDomTest(file)) throw new Error(`Not a desktop spec or DOM lane test: ${file}`)
  const specs = files.filter(isDesktopSpec).map((file) => file.slice('apps/desktop/'.length))
  const dom = files.filter(isDomTest)
  // The tier's own tags must not be skipped here, whatever the caller skips.
  const skip = (process.env.JUNO_SKIP_TAGS ?? '').split(',').filter((tag) => tag && !tag.startsWith('@nightly'))
  const env = { ...process.env, JUNO_SKIP_TAGS: skip.join(','), JUNO_DOM_WORKERS: process.env.JUNO_DOM_WORKERS ?? process.env.JUNO_RUNNER_JOB_CORES ?? '' }
  if (!env.JUNO_DOM_WORKERS) delete env.JUNO_DOM_WORKERS
  const steps = [
    ...(specs.length > 0 ? [{ cwd: join(root, 'apps/desktop'), args: [join(root, 'scripts/without-run-as-node.mjs'), 'playwright', 'test', '--grep', '@nightly', '--pass-with-no-tests', ...specs] }] : []),
    ...(dom.length > 0 ? [{ cwd: root, args: [join(root, 'scripts/dom-tests.mjs'), '--files', ...dom] }] : []),
  ]
  console.log(`nightly: ${specs.length} desktop spec(s), ${dom.length} DOM file(s)`)
  const children = new Set()
  forwardSignals(children)
  let code = 0
  for (const step of steps) {
    const child = spawn(process.execPath, step.args, { cwd: step.cwd, stdio: 'inherit', env })
    children.add(child)
    const exit = await new Promise((done) => child.on('close', (status, signal) => done(signal ? 130 : status ?? 1)))
    children.delete(child)
    code = Math.max(code, exit)
  }
  process.exit(code)
}
