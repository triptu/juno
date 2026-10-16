// Works out which tests a change can affect, and runs only those.
//
//   pnpm affected                 local Bun check, then the affected suites on one Namespace machine
//   pnpm affected --plan          print the plan only
//   pnpm affected --local         run the plan through the local root scripts
//   pnpm affected --base <ref>    compare with another ref (default: the merge base with main)
//   pnpm affected --plan --files packages/ui/src/Chip.tsx   plan for those files
//   pnpm affected --graph         pick desktop specs by the import graph, not the coverage map
//   pnpm affected --plan --range a..b   plan for what changed between two commits
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
// - Gallery: the shift guard for the components whose fixtures reach a
//   changed file, and the other behaviour specs that open one of those
//   components (or walk every one); all of it when the gallery app, the shift
//   guard, @juno/testing or the tokens changed.
// - Desktop e2e: by the coverage map (apps/desktop/e2e/coverage-map.json,
//   scripts/affected-select.mjs), the specs that ran a changed file, the
//   changed specs, and specs with no coverage. All of it when the shared e2e
//   support changed, and by the import graph when there is no usable map.
// - perf and test:feel never run here. They are listed when the renderer changed.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAP_PATH } from './coverage-map.mjs'
import { ImportGraph } from './import-graph.mjs'
import { driverSpecs, galleryComponents, mapProblem, selectSpecs } from './affected-select.mjs'
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

// --files a,b plans for those files instead of the working tree's changes;
// --range a..b for what changed between two commits (to replay a past merge).
const range = argv.includes('--range') ? argv[argv.indexOf('--range') + 1].split('..') : undefined
const changed = argv.includes('--files')
  ? argv[argv.indexOf('--files') + 1].split(',')
  : range
    ? git('diff', '--name-only', range[0], range[1])
    : [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])].toSorted()
const files = new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages').filter((file) => existsSync(join(root, file))))

/** Files every suite depends on: a change to one runs everything. */
const everything = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'tsconfig.base.json', 'scripts/affected.mjs', 'scripts/affected-select.mjs', 'scripts/import-graph.mjs', 'scripts/coverage-map.mjs', 'scripts/remote.mjs', 'scripts/heavy.mjs', 'scripts/build-cached.mjs', 'scripts/without-run-as-node.mjs']
const everythingChanged = changed.filter((file) => everything.includes(file) || file.startsWith('scripts/remote/'))

const graph = new ImportGraph(root, files)
const closure = (file) => graph.closure(file)
const resolveImport = (from, specifier) => graph.resolveImport(from, specifier)
const importers = (file) => graph.importers(file)

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
// The gallery app and what its tests share reach every component; a spec file reaches itself.
const galleryBase = [...files].filter((file) => (file.startsWith('apps/gallery/') && !file.endsWith('.spec.ts')) || file === 'apps/gallery/shift.spec.ts' || file.startsWith('packages/testing/') || file.startsWith('packages/tokens/'))
const componentItems = [...componentFixtures()].map(([name, fixture]) => ({ suite: 'gallery', id: name, inputs: new Set([...closure(fixture), ...galleryBase]) }))
// The behaviour specs other than the shift guard, each by the components it opens.
const componentInputs = new Map(componentItems.map((item) => [item.id, item.inputs]))
const gallerySpecItems = [...files]
  .filter((file) => /^apps\/gallery\/[^/]+\.spec\.ts$/.test(file) && !['apps/gallery/shots.spec.ts', 'apps/gallery/shift.spec.ts'].includes(file))
  .map((file) => {
    const opens = galleryComponents(readFileSync(join(root, file), 'utf8'), componentInputs)
    const reached = opens === '*' ? [...componentInputs.values()] : opens.map((name) => componentInputs.get(name))
    return { suite: 'gallery', id: file, opens, inputs: new Set([...closure(file), ...galleryBase, ...reached.flatMap((inputs) => [...inputs])]) }
  })
const components = pending(componentItems)
const gallerySpecs = pending(gallerySpecItems)
const touchedComponents = new Set(componentItems.filter((item) => touches(item.inputs)).map((item) => item.id))
const galleryReason = (item) => {
  if (changed.includes(item.id)) return 'the spec changed'
  if (item.opens === '*') return 'it walks every component'
  const opened = item.opens.filter((name) => touchedComponents.has(name))
  return opened.length > 0 ? `it opens ${opened.join(', ')}` : 'what it reaches changed'
}
if (components.length > 0 || gallerySpecs.length > 0) {
  const all = components.length === componentItems.length && gallerySpecs.length === gallerySpecItems.length
  // Playwright reads each as an unanchored pattern: the slash keeps geometry.spec.ts from matching list-geometry.spec.ts.
  const specFiles = [...(components.length > 0 ? ['/shift.spec.ts'] : []), ...gallerySpecs.map((item) => item.id.replace('apps/gallery', ''))]
  plan.push({
    script: 'test:gallery',
    args: all ? [] : specFiles,
    // Partial gallery runs use four cores; the full suite needs eight.
    env: all || components.length === 0 ? undefined : { GALLERY_SHIFT_ONLY: components.map((item) => item.id).join(',') },
    items: [...components, ...gallerySpecs],
    why: all
      ? 'every component and behaviour spec'
      : `${components.length} component(s) in the shift guard${components.length ? `: ${components.map((item) => item.id).join(', ')}` : ''}; ${gallerySpecs.length} of ${gallerySpecItems.length} behaviour spec file(s)`,
    reasons: all ? undefined : gallerySpecs.map((item) => [item.id.replace('apps/gallery/', ''), [galleryReason(item)]]),
  })
}

// Desktop e2e, by spec file. The import graph says the app reaches nearly
// every file, so the coverage map decides which specs ran a changed file
// (scripts/affected-select.mjs). Without a usable map, every spec runs when
// the app or the e2e support changed.
const desktopEntries = [...files].filter((file) => /^apps\/desktop\/src\/(main|preload|engine|agent)\/index\.ts$/.test(file) || file === 'apps/desktop/src/renderer/main.tsx')
// What every spec depends on: the fixtures, the driver, the build and Playwright configs, and what they reach (the fake Slack).
const supportRoots = [...files].filter((file) => /^apps\/desktop\/e2e\/(fixtures\.ts|build\.ts|coverage\.ts|no-skips\.ts|driver\/)/.test(file) || ['apps/desktop/playwright.config.ts', 'apps/desktop/package.json', 'apps/desktop/electron.vite.config.ts', 'apps/desktop/src/renderer/index.html', 'apps/desktop/src/coverage.ts'].includes(file))
const support = new Set(supportRoots.flatMap((file) => [...closure(file)]))
const app = new Set(desktopEntries.flatMap((entry) => [...closure(entry)]))
for (const file of [...files].filter((path) => path.startsWith('apps/desktop/src/renderer/'))) app.add(file)
// The fake Slack's files the app also runs (the shared Slack schema) are left to the coverage map.
for (const file of app) if (!/^(apps\/desktop\/e2e|packages\/fake-slack|packages\/agent-testing)\//.test(file) && !supportRoots.includes(file)) support.delete(file)
const specItems = [...files]
  .filter((file) => /^apps\/desktop\/e2e\/.*\.spec\.ts$/.test(file) && !/perf\.spec|screens\.spec|panel-shots\.spec|live\.spec/.test(file))
  .map((file) => ({ suite: 'desktop', id: file, inputs: new Set([...app, ...support, ...closure(file)]) }))

/** A changed file's text after the change, or undefined when it was deleted. */
function textAtChange(file) {
  if (range) {
    const shown = spawnSync('git', ['show', `${range[1]}:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return shown.status === 0 ? shown.stdout : undefined
  }
  return existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : undefined
}

/** The lines of a changed file that the change added or edited (where lines were only removed, the line before). */
function changedLines(file) {
  const tracked = range ?? (git('ls-files', '--', file).length > 0 ? [base] : undefined)
  if (tracked === undefined) return (textAtChange(file) ?? '').split('\n').map((_, index) => index + 1)
  const lines = []
  for (const hunk of git('diff', '-U0', ...tracked, '--', file).filter((line) => line.startsWith('@@'))) {
    const [, start, count] = /\+(\d+)(?:,(\d+))?/.exec(hunk).map(Number)
    const length = Number.isNaN(count) ? 1 : count
    if (length === 0) lines.push(Math.max(start, 1))
    for (let line = start; line < start + length; line++) lines.push(line)
  }
  return lines
}

/** The coverage map's selection, or why it was not used. */
function desktopSelection() {
  if (everythingChanged.length > 0) return { all: `${everythingChanged[0]} changed` }
  if (flag('--graph')) return { all: 'asked for by --graph; the import graph decides' }
  const map = existsSync(join(root, MAP_PATH)) ? JSON.parse(readFileSync(join(root, MAP_PATH), 'utf8')) : undefined
  const commitKnown = map !== undefined && spawnSync('git', ['cat-file', '-e', `${map.commit}^{commit}`], { cwd: root }).status === 0
  const problem = mapProblem(map, { commitKnown })
  if (problem) return { all: `${problem}; the import graph decides`, graph: true }
  const existed = new Set(git('ls-tree', '-r', '--name-only', map.commit, '--', 'apps', 'packages'))
  const drift = new Set([...changed, ...git('diff', '--name-only', map.commit), ...git('ls-files', '--others', '--exclude-standard')])
  const own = (spec) => new Set([...closure(spec)].filter((file) => !app.has(file) && !support.has(file)))
  const specTexts = new Map(specItems.map((item) => [item.id, [...own(item.id)].map((file) => readFileSync(join(root, file), 'utf8')).join('\n')]))
  const driverTexts = [...files].filter((file) => file.startsWith('apps/desktop/e2e/driver/')).map((file) => readFileSync(join(root, file), 'utf8'))
  const driver = (changedDriver) => {
    if (argv.includes('--files')) return undefined
    const edits = changedDriver.map((file) => ({ text: textAtChange(file), lines: changedLines(file) }))
    return edits.some((edit) => edit.text === undefined) ? undefined : driverSpecs({ changed: edits, driverTexts, specTexts })
  }
  return selectSpecs({ specs: specItems.map((item) => item.id), changed, map, support, own, app, isNew: (file) => !existed.has(file), drift, importers, driver })
}
const selection = desktopSelection()
const specs = pending(selection.specs ? specItems.filter((item) => selection.specs.has(item.id)) : specItems)
if (specs.length > 0) {
  const every = specs.length === specItems.length
  plan.push({
    script: 'test:desktop',
    args: every ? [] : specs.map((item) => item.id.replace('apps/desktop/', '')),
    items: specs,
    why: selection.specs ? `${specs.length} of ${specItems.length} e2e spec file(s), by the coverage map` : `every desktop e2e spec: ${selection.all}`,
    reasons: selection.specs ? specs.map((item) => [item.id.replace('apps/desktop/', ''), selection.specs.get(item.id)]) : undefined,
  })
}

if (everythingChanged.length || changed.some((file) => file.startsWith('scripts/health'))) plan.push({ script: 'test:health', args: [], local: true, items: [], why: 'health ratchet rules' })
if (everythingChanged.length || changed.some((file) => file.startsWith('scripts/batch-merge') || file.startsWith('scripts/check-migration-order'))) plan.push({ script: 'test:repo-tools', args: [], local: true, items: [], why: 'repository tool checks' })
if (everythingChanged.length || changed.includes('scripts/flake.mjs')) plan.push({ script: 'test:remote-pool', args: [], local: true, items: [], why: 'remote pool lifecycle decisions' })

const renderer = changed.some((file) => file.startsWith('apps/desktop/src/renderer/') || file.startsWith('packages/views/src/') || file.startsWith('packages/ui/src/') || file.startsWith('packages/tokens/'))

console.log(`affected: ${changed.length} changed file(s) since ${base.slice(0, 10)}${everythingChanged.length ? `; ${everythingChanged.join(', ')} changed, so everything runs` : ''}`)
for (const step of plan) {
  console.log(`  pnpm ${step.script}${step.args.length ? ` ${step.args.length > 6 ? `${step.args.slice(0, 6).join(' ')} ... (${step.args.length} args)` : step.args.join(' ')}` : ''}${step.env ? ` with ${Object.entries(step.env).map(([key, value]) => `${key}=${value}`).join(' ')}` : ''}   # ${step.why}`)
  for (const [id, why] of step.reasons ?? []) console.log(`      ${id}: ${why[0]}${why.length > 1 ? ` (and ${why.length - 1} more)` : ''}`)
}
if (skipped > 0) console.log(`  (${skipped} item(s) skipped: they passed before with the same inputs; --no-cache runs them)`)
if (plan.length === 0) console.log('  nothing to run')
if (renderer) console.log('  (UI changed: run pnpm test:feel and pnpm perf on the Mac before a milestone review)')
if (flag('--plan') || plan.length === 0) process.exit(0)

// The remote steps run as one plan on one Namespace machine (scripts/plan.mjs),
// beside the local steps; --local runs every step one after another here.
const children = new Set()
forwardSignals(children)
const localAll = flag('--local')
const spawnStep = (command, env, onLine) =>
  new Promise((resolvePromise) => {
    const child = spawn(command[0], command[1], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    children.add(child)
    child.on('close', () => children.delete(child))
    for (const stream of [child.stdout, child.stderr]) {
      let rest = ''
      stream.on('data', (chunk) => {
        const lines = (rest + chunk).split('\n')
        rest = lines.pop()
        for (const line of lines) onLine(line)
      })
    }
    child.on('close', (code) => resolvePromise(code ?? 1))
  })
const run = async (step) => ({ step, code: await spawnStep(['pnpm', [step.script, ...step.args]], step.env, (line) => process.stdout.write(`[${step.script}] ${line}\n`)) })
/** One remote machine for every remote step; each step's result comes from the plan's `plan: step` lines. */
const runRemote = async (steps) => {
  const words = steps.flatMap((step, index) => [...(index ? ['+'] : []), ...Object.entries(step.env ?? {}).map(([key, value]) => `${key}=${value}`), step.script, ...step.args])
  const codes = new Map()
  const code = await spawnStep(['node', [join(root, 'scripts/remote.mjs'), 'test:plan', ...words]], {}, (line) => {
    const result = /^plan: step (\d+) \S+ exited with (\d+)/.exec(line)
    if (result) codes.set(Number(result[1]), Number(result[2]))
    process.stdout.write(`${line}\n`)
  })
  // A step with no result line did not finish: the run failed before or during it.
  return steps.map((step, index) => ({ step, code: codes.get(index) ?? (code || 1) }))
}
// Fail on local type errors before paying for remote machines.
const localTypecheck = plan.find((step) => step.script === 'typecheck')
const results = localTypecheck ? [await run(localTypecheck)] : []
if (results.some(({ code }) => code !== 0)) process.exit(1)
const remaining = plan.filter((step) => step !== localTypecheck)
if (localAll) for (const step of remaining) results.push(await run(step))
else {
  const remote = remaining.filter((step) => !step.local)
  const local = (async () => {
    const done = []
    for (const step of remaining.filter((item) => item.local)) done.push(await run(step))
    return done
  })()
  const [localResults, remoteResults] = await Promise.all([local, remote.length ? runRemote(remote) : []])
  results.push(...localResults, ...remoteResults)
}
mkdirSync(resultsDir, { recursive: true })
for (const { step, code } of results) if (code === 0) for (const item of step.items) writeFileSync(join(resultsDir, item.key), `${item.suite} ${item.id}\n`)
console.log('affected: results')
for (const { step, code } of results) console.log(`  ${code === 0 ? 'passed' : `failed (${code})`}  pnpm ${step.script}`)
process.exit(results.every(({ code }) => code === 0) ? 0 : 1)
