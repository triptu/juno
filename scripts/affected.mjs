// Works out which tests a change can affect, and runs only those.
//
//   pnpm affected                 plan and run against main, on Namespace (pnpm remote)
//   pnpm affected --plan          print the plan only
//   pnpm affected --local         run the plan through the local root scripts
//   pnpm affected --base <ref>    compare with another ref (default: the merge base with main)
//   pnpm affected --plan --files packages/ui/src/Chip.tsx   plan for those files
//
// The change is every file that differs from the merge base, committed or not,
// plus new files. An import graph over apps/ and packages/ (relative imports,
// @juno/* through each package's exports, named imports followed through
// barrel re-exports) decides what each change reaches. The rules, in
// docs/development.md ("Affected tests"):
//
// - Everything runs when a file every suite depends on changed (the lockfile,
//   the workspace file, the root package.json, tsconfig.base.json, these scripts).
// - Unit tests: the vitest files whose imports reach a changed file, and every
//   test of a package whose package.json or vitest config changed.
// - Specs: specs:check, narrowed to --memory, --actions or --recovery when only
//   that agent spec changed. Its own cache skips checks whose inputs passed before.
// - Gallery: the behaviour tests and the shift guard for the components whose
//   fixtures reach a changed file; all components when the gallery app, its
//   tests or @juno/testing changed.
// - Desktop e2e: all of it when a file the app or the e2e support reaches
//   changed; otherwise the changed spec files only.
// - perf and test:feel never run here. They are listed when the renderer changed.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : spawnSync('git', ['merge-base', 'HEAD', 'main'], { cwd: root, encoding: 'utf8' }).stdout.trim()

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.split('\n').filter(Boolean)
}

// --files a,b plans for those files instead of the working tree's changes.
const changed = argv.includes('--files')
  ? argv[argv.indexOf('--files') + 1].split(',')
  : [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])].toSorted()
const files = new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages').filter((file) => existsSync(join(root, file))))

/** Files every suite depends on: a change to one runs everything. */
const everything = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'tsconfig.base.json', 'scripts/affected.mjs', 'scripts/remote.mjs', 'scripts/heavy.mjs', 'scripts/build-cached.mjs', 'scripts/without-run-as-node.mjs']
const everythingChanged = changed.filter((file) => everything.includes(file) || file.startsWith('scripts/remote/'))

// Workspace packages and their exports, for @juno/* imports.
const packages = new Map()
for (const file of files) {
  const match = /^((?:apps|packages)\/[^/]+)\/package\.json$/.exec(file)
  if (!match) continue
  const manifest = JSON.parse(readFileSync(join(root, file), 'utf8'))
  packages.set(manifest.name, { dir: match[1], exports: typeof manifest.exports === 'string' ? { '.': manifest.exports } : (manifest.exports ?? {}) })
}

const extensions = ['', '.ts', '.tsx', '.mjs', '.js', '.css', '/index.ts', '/index.tsx']
function resolveImport(from, specifier) {
  let target
  if (specifier.startsWith('.')) target = normalize(join(dirname(from), specifier))
  else {
    const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/')
    const workspace = packages.get(name)
    if (!workspace) return undefined
    const sub = `.${specifier.slice(name.length)}`
    const exported = workspace.exports[sub === '.' ? '.' : sub]
    const path = typeof exported === 'string' ? exported : (exported?.import ?? exported?.default)
    target = path ? normalize(join(workspace.dir, path)) : normalize(join(workspace.dir, sub))
  }
  for (const extension of extensions) if (files.has(target + extension)) return target + extension
  return undefined
}

const importPattern = /(?:import|export)\s+(type\s+)?([\w*{}\s,$]*?)\s*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)|@import\s+(?:url\()?['"]([^'"]+)['"]/g
const parsed = new Map()
/** Each import of a file: where it points and which names it takes (undefined means the whole module). */
function importsOf(file) {
  if (parsed.has(file)) return parsed.get(file)
  const list = []
  if (/\.(ts|tsx|mjs|js|cjs|css)$/.test(file)) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[3] ?? match[4] ?? match[5] ?? match[6] ?? match[7]
      const target = resolveImport(file, specifier)
      if (!target) continue
      const clause = match[2]
      const named = clause && /^\{[^}]*\}$/.test(clause.trim()) ? clause.trim().slice(1, -1).split(',').map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean) : undefined
      list.push({ target, named, reexport: match[0].startsWith('export') })
    }
  }
  parsed.set(file, list)
  return list
}

/** For a barrel, which file each re-exported name comes from. */
function barrelSources(file) {
  const sources = new Map()
  const stars = []
  for (const entry of importsOf(file)) {
    if (!entry.reexport) continue
    if (entry.named) for (const name of entry.named) sources.set(name, entry.target)
    else stars.push(entry.target)
  }
  return { sources, stars }
}

/** Whether a module declares or re-exports `name` itself. */
const declared = new Map()
function declares(file, name) {
  if (!declared.has(file)) {
    const text = /\.(ts|tsx|mjs|js)$/.test(file) ? readFileSync(join(root, file), 'utf8') : ''
    const names = new Set()
    for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum|namespace)\s+(\w+)/g)) names.add(match[1])
    for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) for (const part of match[1].split(',')) names.add(part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).at(-1))
    declared.set(file, names)
  }
  return declared.get(file).has(name)
}

/** Every file `start` reaches. Named imports from a barrel reach only the files that define those names. */
const closures = new Map()
function closure(start) {
  if (closures.has(start)) return closures.get(start)
  const reached = new Set()
  const names = new Set()
  const walk = (file, imported) => {
    const { sources, stars } = barrelSources(file)
    const barrel = imported && (sources.size > 0 || stars.length > 0) && importsOf(file).every((entry) => entry.reexport)
    if (barrel) {
      reached.add(file)
      for (const name of imported) {
        if (names.has(`${file}#${name}`)) continue
        names.add(`${file}#${name}`)
        if (sources.has(name)) walk(sources.get(name), [name])
        else for (const star of stars.filter((candidate) => declares(candidate, name) || barrelSources(candidate).stars.length > 0)) walk(star, [name])
      }
      return
    }
    if (names.has(`${file}#*`)) return
    names.add(`${file}#*`)
    reached.add(file)
    for (const entry of importsOf(file)) walk(entry.target, entry.reexport ? undefined : entry.named)
  }
  walk(start, undefined)
  closures.set(start, reached)
  return reached
}

const touches = (reached) => changed.some((file) => reached.has(file))
const plan = []

// Unit tests.
const unit = []
for (const file of files) {
  if (!/^packages\/[^/]+\/test\/.*\.test\.ts$/.test(file)) continue
  const dir = file.split('/').slice(0, 2).join('/')
  const own = changed.some((path) => path === `${dir}/package.json` || path.startsWith(`${dir}/vitest.config`) || path === `${dir}/tsconfig.json`)
  if (everythingChanged.length > 0 || own || touches(closure(file))) unit.push(file)
}
// vitest matches filters against paths inside each package. Two packages with a
// test of the same name both run it, which only costs time.
const filters = [...new Set(unit.map((file) => file.split('/').slice(2).join('/')))]
if (unit.length > 0) plan.push({ script: 'test', args: everythingChanged.length > 0 ? [] : ['--passWithNoTests', ...filters], why: `${unit.length} vitest file(s)` })

// Specs.
const specChanges = changed.filter((file) => file.startsWith('specs/') && !file.endsWith('.md'))
if (everythingChanged.length > 0 || specChanges.length > 0) {
  const only = { 'specs/agent-memory.qnt': '--memory', 'specs/agent-actions.qnt': '--actions', 'specs/agent-recovery.qnt': '--recovery', 'specs/agent-recovery-replay.qnt': '--recovery' }
  const modes = new Set(specChanges.map((file) => only[file] ?? 'all'))
  const args = everythingChanged.length === 0 && modes.size === 1 && !modes.has('all') ? [...modes] : []
  plan.push({ script: 'specs:check', args, why: `${specChanges.length || 'shared'} spec input(s) changed${args.length ? `, ${args[0].slice(2)} only` : ''}` })
}

// Gallery.
function componentFixtures() {
  const map = new Map()
  for (const registry of ['packages/ui/src/fixtures.ts', 'packages/views/src/fixtures.ts']) {
    if (!files.has(registry)) continue
    const text = readFileSync(join(root, registry), 'utf8')
    const sources = new Map()
    for (const match of text.matchAll(/import\s+(\w+)\s+from\s+'([^']+)'/g)) sources.set(match[1], resolveImport(registry, match[2]))
    const body = text.slice(text.indexOf('export const fixtures'))
    for (const match of body.matchAll(/^\s+(\w+)(?::\s*(\w+))?,/gm)) {
      const source = sources.get(match[2] ?? match[1])
      if (source) map.set(match[1], source)
    }
  }
  return map
}
const galleryWhole = everythingChanged.length > 0 || changed.some((file) => (file.startsWith('apps/gallery/') && file !== 'apps/gallery/shots.spec.ts') || file.startsWith('packages/testing/') || file.startsWith('packages/tokens/'))
const components = [...componentFixtures()].filter(([, fixture]) => touches(closure(fixture))).map(([name]) => name)
if (galleryWhole) plan.push({ script: 'test:gallery', args: [], why: 'the gallery, its tests, the tokens or @juno/testing changed: every component' })
else if (components.length > 0) plan.push({ script: 'test:gallery', args: [], env: { GALLERY_SHIFT_ONLY: components.join(',') }, why: `${components.length} component(s): ${components.join(', ')}` })

// Desktop e2e.
const desktopEntries = [...files].filter((file) => /^apps\/desktop\/src\/(main|preload|engine|agent)\/index\.ts$/.test(file) || file === 'apps/desktop/src/renderer/main.tsx' || file === 'apps/desktop/electron.vite.config.ts')
const support = [...files].filter((file) => /^apps\/desktop\/e2e\/(fixtures\.ts|driver\/)/.test(file) || file === 'apps/desktop/playwright.config.ts' || file === 'apps/desktop/package.json')
const app = new Set(desktopEntries.flatMap((entry) => [...closure(entry)]))
for (const file of support) for (const reached of closure(file)) app.add(reached)
for (const file of [...files].filter((path) => path.startsWith('apps/desktop/src/renderer/'))) app.add(file)
const e2eChanged = changed.filter((file) => /^apps\/desktop\/e2e\/.*\.spec\.ts$/.test(file) && !file.includes('perf.spec'))
if (everythingChanged.length > 0 || touches(app)) plan.push({ script: 'test:desktop', args: [], why: 'the app or the e2e support changed: every desktop e2e test' })
else if (e2eChanged.length > 0) plan.push({ script: 'test:desktop', args: e2eChanged.map((file) => file.replace('apps/desktop/', '')), why: `${e2eChanged.length} changed e2e spec(s)` })

const renderer = changed.some((file) => file.startsWith('apps/desktop/src/renderer/') || file.startsWith('packages/views/src/') || file.startsWith('packages/ui/src/') || file.startsWith('packages/tokens/'))

console.log(`affected: ${changed.length} changed file(s) since ${base.slice(0, 10)}${everythingChanged.length ? `; ${everythingChanged.join(', ')} changed, so everything runs` : ''}`)
for (const step of plan) console.log(`  pnpm ${step.script}${step.args.length ? ` ${step.args.length > 6 ? `${step.args.slice(0, 6).join(' ')} ... (${step.args.length} args)` : step.args.join(' ')}` : ''}${step.env ? ` with ${Object.entries(step.env).map(([key, value]) => `${key}=${value}`).join(' ')}` : ''}   # ${step.why}`)
if (plan.length === 0) console.log('  nothing to run')
if (renderer) console.log('  (UI changed: run pnpm test:feel and pnpm perf on the Mac before a milestone review)')
if (flag('--plan') || plan.length === 0) process.exit(0)

// Each step runs at once: on its own Namespace machine, or one after another locally.
const local = flag('--local')
const run = (step) =>
  new Promise((resolvePromise) => {
    const env = Object.entries(step.env ?? {}).flatMap(([key, value]) => ['--env', `${key}=${value}`])
    const command = local ? ['pnpm', [step.script, ...step.args]] : ['node', [join(root, 'scripts/remote.mjs'), ...env, step.script, ...step.args]]
    const child = spawn(command[0], command[1], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(local ? step.env : {}) } })
    const prefix = `[${step.script}] `
    for (const stream of [child.stdout, child.stderr]) {
      let rest = ''
      stream.on('data', (chunk) => {
        const lines = (rest + chunk).split('\n')
        rest = lines.pop()
        for (const line of lines) process.stdout.write(prefix + line + '\n')
      })
    }
    child.on('close', (code) => resolvePromise({ step, code: code ?? 1 }))
  })
const results = local ? [] : await Promise.all(plan.map(run))
if (local) for (const step of plan) results.push(await run(step))
console.log('affected: results')
for (const { step, code } of results) console.log(`  ${code === 0 ? 'passed' : `failed (${code})`}  pnpm ${step.script}`)
process.exit(results.every(({ code }) => code === 0) ? 0 : 1)
