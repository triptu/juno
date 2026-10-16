// Works out which tests a change can affect, and runs only those.
//
//   pnpm affected                 local Bun check, then affected suites on Namespace
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
// - Conformance: specs:conformance when the outbox spec or a file its replay
//   against the engine reaches changed.
// - Gallery: the behaviour tests and the shift guard for the components whose
//   fixtures reach a changed file; all components when the gallery app, its
//   tests or @juno/testing changed.
// - Desktop e2e: all of it when a file the app or the e2e support reaches
//   changed; otherwise the changed spec files only.
// - perf and test:feel never run here. They are listed when the renderer changed.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forwardSignals } from './remote/children.mjs'

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

// Bun checks locally and keeps its own cache. Unsupported configs are reported
// and skipped; routine affected checks never invoke TypeScript.
const typecheckArgs = flag('--no-cache') ? ['--no-cache'] : []
const listed = spawnSync(process.execPath, [join(root, 'scripts/typecheck-bun.mjs'), '--pending', ...typecheckArgs], { cwd: root, encoding: 'utf8' })
if (listed.status !== 0) throw new Error(listed.stderr || 'Could not plan local typecheck')
const typecheckPending = JSON.parse(listed.stdout)
for (const project of typecheckPending.skipped) console.warn(`warning: skipping ${project.label}; Bun cannot check this project (${project.reason})`)
if (typecheckPending.bun.length > 0) plan.push({ script: 'typecheck', args: typecheckArgs, items: [], local: true, why: `${typecheckPending.bun.length} project(s), pinned Bun locally` })
// The whole lint takes about 3 s, less than a remote machine's overhead, so it runs here.
if (changed.some((file) => !file.endsWith('.md'))) plan.push({ script: 'lint', args: [], items: [], local: true, why: 'the whole lint, on this Mac (about 3 s)' })

// Results. A passing item is recorded under a hash of every file it reaches, the
// package and suite configs it depends on, and the lockfile, in the system temp
// folder shared by every worktree. An item whose key passed before is skipped,
// whether it passed here or on a remote machine. --no-cache runs everything.
const resultsDir = join(tmpdir(), 'juno-cache', 'results')
const useCache = !flag('--no-cache')
const contentHash = new Map()
const hashOf = (file) => {
  if (!contentHash.has(file)) contentHash.set(file, existsSync(join(root, file)) ? createHash('sha256').update(readFileSync(join(root, file))).digest('hex') : 'absent')
  return contentHash.get(file)
}
const shared = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'tsconfig.base.json']
const keyOf = (suite, id, inputs) => {
  const hash = createHash('sha256').update(`${suite}\0${id}\0`)
  for (const file of [...new Set([...shared, ...inputs])].toSorted()) hash.update(`${file}\0${hashOf(file)}\0`)
  return hash.digest('hex')
}
const passed = (key) => useCache && existsSync(join(resultsDir, key))
let skipped = 0
/** The items that need a run: their inputs changed (or everything did) and their key has not passed. */
const pending = (items) =>
  items.filter((item) => {
    if (!(everythingChanged.length > 0 || item.own || touches(item.inputs))) return false
    item.key = keyOf(item.suite, item.id, item.inputs)
    if (passed(item.key)) skipped++
    return !passed(item.key)
  })

// Unit tests.
const unitItems = [...files]
  .filter((file) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(file))
  .map((file) => {
    const dir = file.split('/').slice(0, 2).join('/')
    const config = [`${dir}/package.json`, `${dir}/vitest.config.ts`, `${dir}/tsconfig.json`]
    return { suite: 'test', id: file, inputs: new Set([...closure(file), ...config]), own: changed.some((path) => config.includes(path)) }
  })
const unit = pending(unitItems)
// vitest matches filters against paths inside each package. Two packages with a
// test of the same name both run it, which only costs time.
const filters = [...new Set(unit.map((item) => item.id.split('/').slice(2).join('/')))]
if (unit.length > 0) plan.push({ script: 'test', args: unit.length === unitItems.length ? [] : ['--passWithNoTests', ...filters], items: unit, why: `${unit.length} vitest file(s)` })

// Specs. specs:check keeps its own cache of passing Quint runs.
const specChanges = changed.filter((file) => file.startsWith('specs/') && !file.endsWith('.md'))
if (everythingChanged.length > 0 || specChanges.length > 0) {
  const only = { 'specs/agent-memory.qnt': '--memory', 'specs/agent-actions.qnt': '--actions', 'specs/agent-recovery.qnt': '--recovery', 'specs/agent-recovery-replay.qnt': '--recovery' }
  const modes = new Set(specChanges.map((file) => only[file] ?? 'all'))
  const args = everythingChanged.length === 0 && modes.size === 1 && !modes.has('all') ? [...modes] : []
  plan.push({ script: 'specs:check', args, items: [], why: `${specChanges.length || 'shared'} spec input(s) changed${args.length ? `, ${args[0].slice(2)} only` : ''}` })
}

// Conformance: the outbox traces replayed against the engine (specs/README.md,
// "Conformance"). It runs when the outbox spec, its generator, or any file
// the replay reaches (the engine, sync, the fake Slack) changed.
const conformanceSpecs = ['specs/outbox.qnt', 'specs/outbox-conformance.qnt', 'specs/outbox-checks.mjs', 'specs/conformance.mjs', 'packages/engine/vitest.conformance.config.ts']
const conformanceItem = { suite: 'conformance', id: 'outbox', inputs: new Set([...closure('packages/engine/test/conformance/outbox.conformance.ts'), ...conformanceSpecs]) }
if (pending([conformanceItem]).length > 0) plan.push({ script: 'specs:conformance', args: [], items: [conformanceItem], why: 'the outbox spec or the code its replay reaches changed' })

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
// The gallery app, its tests and what they share reach every component.
const galleryBase = [...files].filter((file) => (file.startsWith('apps/gallery/') && file !== 'apps/gallery/shots.spec.ts') || file.startsWith('packages/testing/') || file.startsWith('packages/tokens/'))
const componentItems = [...componentFixtures()].map(([name, fixture]) => ({ suite: 'gallery', id: name, inputs: new Set([...closure(fixture), ...galleryBase]) }))
const behaviourItem = { suite: 'gallery', id: 'behaviour', inputs: new Set(componentItems.flatMap((item) => [...item.inputs])) }
const components = pending(componentItems)
const behaviour = pending([behaviourItem])
if (components.length > 0 || behaviour.length > 0) {
  const all = components.length === componentItems.length
  plan.push({
    script: 'test:gallery',
    args: [],
    // A name no component has keeps the shift guard idle when only the behaviour tests need a run.
    // Partial gallery runs use four cores; the full suite needs eight.
    env: all ? undefined : { GALLERY_SHIFT_ONLY: components.length > 0 ? components.map((item) => item.id).join(',') : 'none' },
    items: [...components, ...behaviour],
    why: all ? 'every component' : `${components.length} component(s)${components.length ? `: ${components.map((item) => item.id).join(', ')}` : ''}${behaviour.length ? ' and the behaviour tests' : ''}`,
  })
}

// Desktop e2e, by spec file: the app and the e2e support reach every one.
const desktopEntries = [...files].filter((file) => /^apps\/desktop\/src\/(main|preload|engine|agent)\/index\.ts$/.test(file) || file === 'apps/desktop/src/renderer/main.tsx' || file === 'apps/desktop/electron.vite.config.ts')
const support = [...files].filter((file) => /^apps\/desktop\/e2e\/(fixtures\.ts|driver\/)/.test(file) || file === 'apps/desktop/playwright.config.ts' || file === 'apps/desktop/package.json')
const app = new Set(desktopEntries.flatMap((entry) => [...closure(entry)]))
for (const file of support) for (const reached of closure(file)) app.add(reached)
for (const file of [...files].filter((path) => path.startsWith('apps/desktop/src/renderer/'))) app.add(file)
const specItems = [...files]
  .filter((file) => /^apps\/desktop\/e2e\/.*\.spec\.ts$/.test(file) && !/perf\.spec|screens\.spec|live\.spec/.test(file))
  .map((file) => ({ suite: 'desktop', id: file, inputs: new Set([...app, ...closure(file)]) }))
const specs = pending(specItems)
if (specs.length > 0) {
  plan.push({
    script: 'test:desktop',
    args: specs.length === specItems.length ? [] : specs.map((item) => item.id.replace('apps/desktop/', '')),
    items: specs,
    why: specs.length === specItems.length ? 'every desktop e2e spec' : `${specs.length} e2e spec file(s)`,
  })
}

if (everythingChanged.length || changed.some((file) => file.startsWith('scripts/health'))) plan.push({ script: 'test:health', args: [], local: true, items: [], why: 'health ratchet rules' })
if (everythingChanged.length || changed.includes('scripts/flake.mjs')) plan.push({ script: 'test:remote-pool', args: [], local: true, items: [], why: 'remote pool lifecycle decisions' })

const renderer = changed.some((file) => file.startsWith('apps/desktop/src/renderer/') || file.startsWith('packages/views/src/') || file.startsWith('packages/ui/src/') || file.startsWith('packages/tokens/'))

console.log(`affected: ${changed.length} changed file(s) since ${base.slice(0, 10)}${everythingChanged.length ? `; ${everythingChanged.join(', ')} changed, so everything runs` : ''}`)
for (const step of plan) console.log(`  pnpm ${step.script}${step.args.length ? ` ${step.args.length > 6 ? `${step.args.slice(0, 6).join(' ')} ... (${step.args.length} args)` : step.args.join(' ')}` : ''}${step.env ? ` with ${Object.entries(step.env).map(([key, value]) => `${key}=${value}`).join(' ')}` : ''}   # ${step.why}`)
if (skipped > 0) console.log(`  (${skipped} item(s) skipped: they passed before with the same inputs; --no-cache runs them)`)
if (plan.length === 0) console.log('  nothing to run')
if (renderer) console.log('  (UI changed: run pnpm test:feel and pnpm perf on the Mac before a milestone review)')
if (flag('--plan') || plan.length === 0) process.exit(0)

// Each step runs at once: on its own Namespace machine, or one after another locally.
const children = new Set()
forwardSignals(children)
const localAll = flag('--local')
const run = (step) =>
  new Promise((resolvePromise) => {
    const local = localAll || step.local
    const env = Object.entries(step.env ?? {}).flatMap(([key, value]) => ['--env', `${key}=${value}`])
    const machine = step.machine && !process.env.JUNO_REMOTE_MACHINE ? ['--machine', step.machine] : []
    const command = local ? ['pnpm', [step.script, ...step.args]] : ['node', [join(root, 'scripts/remote.mjs'), ...machine, ...env, step.script, ...step.args]]
    const child = spawn(command[0], command[1], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(local ? step.env : {}) } })
    children.add(child)
    child.on('close', () => children.delete(child))
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
// Fail on local type errors before paying for remote machines.
const localTypecheck = plan.find((step) => step.script === 'typecheck')
const results = localTypecheck ? [await run(localTypecheck)] : []
if (results.some(({ code }) => code !== 0)) process.exit(1)
const remaining = plan.filter((step) => step !== localTypecheck)
if (localAll) for (const step of remaining) results.push(await run(step))
else results.push(...await Promise.all(remaining.map(run)))
mkdirSync(resultsDir, { recursive: true })
for (const { step, code } of results) if (code === 0) for (const item of step.items) writeFileSync(join(resultsDir, item.key), `${item.suite} ${item.id}\n`)
console.log('affected: results')
for (const { step, code } of results) console.log(`  ${code === 0 ? 'passed' : `failed (${code})`}  pnpm ${step.script}`)
process.exit(results.every(({ code }) => code === 0) ? 0 : 1)
