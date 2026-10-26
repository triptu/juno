// Which files are tests, for bun run affected (scripts/affected.mjs): the unit
// test files of every package and app (bun test), and the tool tests
// of the repository's scripts with the root script that runs each.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Whether a repo path is a unit test file: in a package or app under
 * `packages/` or `apps/` whose `test` script runs `bun test`, a `*.test.*`
 * file under its bunfig.toml `[test] root` (the package when it names none).
 * Perf (`*.perf.ts`) and conformance files are run by path, so they are not.
 */
export function unitTestMatcher(root) {
  const patterns = new Map()
  const patternsOf = (dir) => {
    if (!patterns.has(dir)) {
      const manifest = join(root, dir, 'package.json')
      const test = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).scripts?.test ?? '' : ''
      if (/^bun test\b/.test(test)) {
        const bunfig = join(root, dir, 'bunfig.toml')
        const testRoot = existsSync(bunfig) ? /^\s*root\s*=\s*"([^"]+)"/m.exec(readFileSync(bunfig, 'utf8'))?.[1] : undefined
        const prefix = testRoot === undefined ? '' : `${testRoot.replace(/^\.\/|\/$/g, '')}/`
        patterns.set(dir, [{ test: (path) => path.startsWith(prefix) && /\.test\.(ts|tsx|mts|js|mjs)$/.test(path) && !path.split('/').includes('node_modules') }])
      } else patterns.set(dir, [])
    }
    return patterns.get(dir)
  }
  return (file) => {
    const parts = file.split('/')
    return /^(packages|apps)$/.test(parts[0]) && parts.length > 2 && patternsOf(parts.slice(0, 2).join('/')).some((pattern) => pattern.test(parts.slice(2).join('/')))
  }
}

/** A script and the scripts it imports, following relative imports. */
function scriptImports(root, file, seen = new Set()) {
  if (seen.has(file) || !existsSync(join(root, file))) return seen
  seen.add(file)
  for (const match of readFileSync(join(root, file), 'utf8').matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) scriptImports(root, join(dirname(file), match[1]), seen)
  return seen
}

/**
 * Each root script that runs `bun test <files>`, with `reached`: the
 * changed files that are one of its tests or a file they import, each with the
 * test (`{ test, file }`).
 */
export function bunTestScripts(root, changed) {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts
  return Object.entries(scripts)
    .filter(([, command]) => /\b(?:node --test|bun test)\b/.test(command))
    .flatMap(([script, command]) => {
      const tests = command.split(/\s+/).filter((word) => /\.test\.[cm]?js$/.test(word))
      return tests.length === 0 ? [] : [{ script, reached: tests.flatMap((test) => [...scriptImports(root, test)].filter((file) => changed.includes(file)).map((file) => ({ test, file }))) }]
    })
}

/** File import closures plus package configs, shared by selection and its cache. */
export function unitTestItems(root, files, changed, closure) {
  return [...files]
    .filter(unitTestMatcher(root))
    .map((file) => {
      const dir = file.split('/').slice(0, 2).join('/')
      const config = [`${dir}/package.json`, `${dir}/bunfig.toml`, `${dir}/tsconfig.json`]
      return { suite: 'test', id: file, inputs: new Set([...closure(file), ...config]), own: changed.some((path) => config.includes(path)) }
    })
}

/** What the DOM lane's test files run against: its renderer bundle and engine host, and their build config. */
export const domEntries = ['apps/desktop/web/page/main.ts', 'apps/desktop/web/host/testHost.ts', 'apps/desktop/dom/vite.config.ts', 'apps/desktop/renderer.vite.ts', 'apps/desktop/web/build-host.mjs']

/** Every DOM lane file reaches the entries' closures, the desktop package and the scripts that build and run it. */
export function domInputs(files, closure) {
  return new Set([...domEntries.filter((file) => files.has(file)).flatMap((file) => [...closure(file)]), 'apps/desktop/package.json', 'scripts/dom-tests.mjs', 'scripts/build-cached.mjs'])
}

/**
 * What every desktop e2e spec runs against: `app`, the closures of the app's entry points and every renderer file,
 * and `support`, the fixtures, the driver, the build and Playwright configs and what they reach (the fake Slack)
 * outside the app. `supportRoots` are the support files themselves.
 */
export function desktopInputs(files, closure) {
  const entries = [...files].filter((file) => /^apps\/desktop\/src\/(main|preload|engine|agent)\/index\.ts$/.test(file) || file === 'apps/desktop/src/renderer/main.tsx')
  const supportRoots = [...files].filter((file) => /^apps\/desktop\/e2e\/(fixtures\.ts|build\.ts|no-skips\.ts|driver\/)/.test(file) || ['apps/desktop/playwright.config.ts', 'apps/desktop/package.json', 'apps/desktop/electron.vite.config.ts', 'apps/desktop/src/renderer/index.html'].includes(file))
  const support = new Set(supportRoots.flatMap((file) => [...closure(file)]))
  const app = new Set(entries.flatMap((entry) => [...closure(entry)]))
  for (const file of [...files].filter((path) => path.startsWith('apps/desktop/src/renderer/'))) app.add(file)
  // The fake Slack's files the app also runs (the shared Slack schema) count as app files.
  for (const file of app) if (!/^(apps\/desktop\/e2e|packages\/fake-slack|packages\/agent-testing)\//.test(file) && !supportRoots.includes(file)) support.delete(file)
  return { app, support, supportRoots }
}
