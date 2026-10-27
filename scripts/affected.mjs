//   bun run affected                 local Bun check, then the affected suites in one remote plan
//   bun run affected --plan          print the plan only
//   bun run affected --local         run the plan through the local root scripts
//   bun run affected --base <ref>    compare with another ref (default: the merge base with main)
//   bun run affected --plan --files packages/ui/src/Chip.tsx   plan for those files
//   bun run affected --plan --range a..b   plan for what changed between two commits
//   bun run affected --plan --json   the plan as JSON
//   bun run affected --spec e2e/tabs.spec.ts   also run that spec (desktop or gallery; repeat or comma-separate)
//   bun run affected --budget-seconds 300  estimated test time for gallery components
//   bun run affected --wide          the wide plan: every spec the change can reach, heavy tests included
//   bun run affected --batch --base <ref>   the batch gate: unit tests, specs:check and conformance only
//   bun run affected --priority high   take laptop cores before waiting normal jobs
//   bun run affected --rerun-changed   rerun changed test files even when more than ten changed (ask Tushar first)
//
// The change is every file that differs from the merge base, committed or not,
// plus new files. An import graph over apps/ and packages/ (relative imports,
// @juno/* through each package's exports, named imports followed through
// barrel re-exports) decides what each change reaches. A change that reaches
// the desktop app runs every desktop e2e spec; otherwise the changed specs run,
// with those that use changed e2e support (scripts/affected-select.mjs).
// Heavy tests, the Quint checks and the perf suggestion follow the areas in
// scripts/test-areas.mjs. The rules are in docs/development.md ("Affected
// tests"); --wide plans as before 10-18. scripts/affected-run.mjs runs the plan.

import { spawnSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ImportGraph } from './import-graph.mjs'
import { galleryComponents, GALLERY_BUDGET_SECONDS, rankComponents, reachSpecs } from './affected-select.mjs'
import { feelScenarios, guardSpecsChanged, HEAVY_AREAS, heavyAreasChanged, perfInteractionsChanged } from './test-areas.mjs'
import { runPlan } from './affected-run.mjs'
import { bunTestScripts, desktopInputs, domInputs, unitTestItems } from './affected-tests.mjs'
import { isDomTest } from './dom-tests.mjs'
import { inputKey, protocolInputs, runtimeIdentity, sameIdentity } from './verify-inputs.mjs'
import { readRecords, statusFolder } from './release-gate.mjs'
import { specDurations } from './verify-records.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const values = (name) => argv.flatMap((arg, at) => (arg === name && at + 1 < argv.length ? argv[at + 1].split(',') : []))
const wide = flag('--wide')
const batch = flag('--batch')
const budget = argv.includes('--budget-seconds') ? Number(argv[argv.indexOf('--budget-seconds') + 1]) : GALLERY_BUDGET_SECONDS
if (!Number.isFinite(budget) || budget < 0) throw new Error('--budget-seconds must be a non-negative number')
// --priority high (or JUNO_PRIORITY=high) puts the laptop jobs ahead of waiting normal ones; remote.mjs reads the env.
if (argv.includes('--priority')) process.env.JUNO_PRIORITY = argv[argv.indexOf('--priority') + 1]
if (![undefined, '', 'normal', 'high'].includes(process.env.JUNO_PRIORITY)) throw new Error('--priority and JUNO_PRIORITY take normal or high')
const identity = runtimeIdentity(root, !flag('--local'))
const durations = specDurations(readRecords(statusFolder(root)), identity)
// Branches are cut from origin/main and the local main is often behind it, so the merge base is taken with origin/main when it exists.
const mergeBase = (ref) => spawnSync('git', ['merge-base', 'HEAD', ref], { cwd: root, encoding: 'utf8' }).stdout.trim()
const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : mergeBase('origin/main') || mergeBase('main')

const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.split('\n').filter(Boolean)
}

// --files a,b plans for those files instead of the working tree's changes;
// --range a..b for what changed between two commits (to replay a past merge).
const range = argv.includes('--range') ? argv[argv.indexOf('--range') + 1].split('..') : undefined
const changed = (argv.includes('--files')
  ? argv[argv.indexOf('--files') + 1].split(',')
  : range
    ? git('diff', '--name-only', range[0], range[1])
    : [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])].toSorted()
)
const files = new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages').filter((file) => existsSync(join(root, file))))

/** What every suite installs and compiles with: a change reaches every unit test, and a sample of every e2e suite. */
const dependencies = ['bun.lock', 'bunfig.toml', 'package.json', 'tsconfig.base.json']
/** The tools that plan and run the suites: a change runs the tool tests and one spec end to end (--wide: everything). */
const tools = ['scripts/affected.mjs', 'scripts/affected-select.mjs', 'scripts/affected-run.mjs', 'scripts/affected-tests.mjs', 'scripts/unit.mjs', 'scripts/dom-tests.mjs', 'scripts/plan.mjs', 'scripts/test-areas.mjs', 'scripts/import-graph.mjs', 'scripts/remote.mjs', 'scripts/heavy.mjs', 'scripts/build-cached.mjs', 'scripts/build-inputs.mjs', 'scripts/locked-packages.mjs', 'scripts/without-run-as-node.mjs']
const toolChanged = changed.filter((file) => tools.includes(file) || file.startsWith('scripts/remote/'))
const deletedSources = wide ? changed.filter((file) => /^(apps|packages)\//.test(file) && !file.endsWith('.md') && !files.has(file)) : []
const everythingChanged = [...changed.filter((file) => dependencies.includes(file)), ...(wide ? toolChanged : []), ...deletedSources]

const graph = new ImportGraph(root, files)
const closure = (file) => graph.closure(file)
const resolveImport = (from, specifier) => graph.resolveImport(from, specifier)

const touches = (reached) => changed.some((file) => reached.has(file))
const plan = []

// Bun checks locally and keeps its own cache. Unsupported configs are reported
// and skipped; routine affected checks never invoke TypeScript.
// The batch gate runs both over the whole merged tree before this (scripts/batch-merge.mjs).
const typecheckArgs = flag('--no-cache') ? ['--no-cache'] : []
if (!batch) {
  const listed = spawnSync(process.execPath, [join(root, 'scripts/typecheck-bun.mjs'), '--pending', ...typecheckArgs], { cwd: root, encoding: 'utf8' })
  if (listed.status !== 0) throw new Error(listed.stderr || 'Could not plan local typecheck')
  const typecheckPending = JSON.parse(listed.stdout)
  for (const project of typecheckPending.skipped) console.warn(`warning: skipping ${project.label}; Bun cannot check this project (${project.reason})`)
  if (typecheckPending.bun.length > 0) plan.push({ script: 'typecheck', args: typecheckArgs, items: [], local: true, why: `${typecheckPending.bun.length} project(s), pinned Bun locally` })
  // The whole lint takes about 3 s, less than a remote machine's overhead, so it runs here.
  if (changed.some((file) => !file.endsWith('.md'))) plan.push({ script: 'lint', args: [], items: [], local: true, why: 'the whole lint, on this Mac (about 3 s)' })
}

// Results. A passing item is recorded under a hash of every file it reaches, the
// package and suite configs it depends on, and the lockfile, in the system temp
// folder shared by every worktree. An item whose key passed before is skipped,
// whether it passed here or on a remote machine. --no-cache runs everything.
const resultsDir = join(tmpdir(), 'juno-cache', 'results')
const useCache = !flag('--no-cache')
const contentHash = new Map()
const shared = ['bun.lock', 'bunfig.toml', 'package.json', 'tsconfig.base.json']
const keyOf = (suite, id, inputs) => inputKey(root, [...shared, ...inputs], { ...identity, suite, id, wide, heavy: heavyAreasChanged(changed) }, contentHash)
const passed = (key) => useCache && existsSync(join(resultsDir, key))
let skipped = 0
/** The items that need a run: their inputs changed (or everything did) and their key has not passed. A forced item (named with --spec) always runs. */
const pending = (items) =>
  items.filter((item) => {
    if (!(everythingChanged.length > 0 || item.own || item.force || touches(item.inputs))) return false
    item.key = keyOf(item.suite, item.id, item.inputs)
    if (item.force) return true
    if (passed(item.key)) skipped++
    return !passed(item.key)
  })

// Unit tests: the bun test files of every package and app (scripts/affected-tests.mjs).
const unitItems = unitTestItems(root, files, changed, closure)
const unit = pending(unitItems)
// Repository paths, so a file never selects a namesake in another package.
// One shuffled order, kept in the step's arguments: `bun run test --seed <n>` repeats it.
const testSeed = process.env.JUNO_TEST_SEED || String(randomInt(1, 2 ** 32))
if (unit.length > 0) plan.push({ script: 'test', args: [`--seed=${testSeed}`, ...(unit.length === unitItems.length ? [] : ['--files', ...unit.map((item) => item.id)])], items: unit, why: `${unit.length} unit test file(s)` })

// The DOM lane (apps/desktop/dom): each test file reaches its own imports and everything the renderer
// bundle and the engine host it runs reach, so the import graph decides; a change to most app code runs every file.
const domApp = domInputs(files, closure)
const domItems = [...files].filter(isDomTest).map((file) => ({ suite: 'dom', id: file, inputs: new Set([...closure(file), ...domApp]) }))
const domFiles = batch ? [] : pending(domItems)
if (domFiles.length > 0) plan.push({ script: 'test:dom', args: [`--seed=${testSeed}`, ...(domFiles.length === domItems.length ? [] : ['--files', ...domFiles.map((item) => item.id)])], items: domFiles, why: `${domFiles.length} DOM lane test file(s)` })

// Protocol checks follow their inputs, independently of the breadth of e2e selection.
const protocols = protocolInputs(git('ls-files', '--cached', '--others', '--exclude-standard'), closure)
const specChanges = changed.filter((file) => protocols['specs:check'].includes(file))
if (specChanges.length > 0) {
  const only = { 'specs/agent-memory.qnt': '--memory', 'specs/agent-actions.qnt': '--actions', 'specs/agent-recovery.qnt': '--recovery', 'specs/agent-recovery-replay.qnt': '--recovery' }
  const modes = new Set(specChanges.map((file) => only[file] ?? 'all'))
  const args = modes.size === 1 && !modes.has('all') ? [...modes] : []
  plan.push({ script: 'specs:check', args, items: [], why: `${specChanges.length} spec input(s) changed${args.length ? `, ${args[0].slice(2)} only` : ''}` })
}
const protocolChanges = changed.filter((file) => protocols['specs:conformance'].includes(file))
const conformanceItem = { suite: 'conformance', id: 'outbox', inputs: new Set(protocols['specs:conformance']) }
if (protocolChanges.length > 0 && pending([conformanceItem]).length > 0)
  plan.push({ script: 'specs:conformance', args: [], items: [conformanceItem], why: `outbox inputs changed: ${protocolChanges.slice(0, 3).join(', ')}` })

// Specs named with --spec run whatever changed: e2e/tabs.spec.ts, apps/desktop/e2e/tabs.spec.ts or geometry.spec.ts (the gallery).
const named = values('--spec').map((spec) => {
  const found = [spec, `apps/desktop/${spec}`, `apps/desktop/e2e/${spec}`, `apps/gallery/${spec}`].find((path) => files.has(path) && path.endsWith('.spec.ts'))
  if (found === undefined) throw new Error(`--spec ${spec}: no desktop or gallery spec file at that path`)
  return found
})

// Heavy (@heavy) tests run only for an area a changed file (or a named spec) is in; the wide plan and a full run
// keep them all.
const heavyActive = new Set(wide ? HEAVY_AREAS.map((area) => area.area) : heavyAreasChanged([...changed, ...named]))
/** The desktop and DOM lanes skip these tags (JUNO_SKIP_TAGS): the heavy areas this change does not reach. */
const skipTags = HEAVY_AREAS.filter((area) => area.suite === 'desktop' && !heavyActive.has(area.area)).map((area) => area.tag)
const skipEnv = skipTags.length > 0 ? { JUNO_SKIP_TAGS: skipTags.join(',') } : {}
for (const step of plan.filter((step) => step.script === 'test:dom' && skipTags.length > 0)) step.env = skipEnv

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
for (const item of gallerySpecItems) if (named.includes(item.id)) item.force = true
const componentCandidates = batch ? [] : pending(componentItems)
const componentSelection = wide || heavyActive.has('gallery') ? { items: componentCandidates, dropped: [] }
  : rankComponents({ components: componentCandidates, all: componentItems, changed, budget, seconds: durations.has('apps/gallery/shift.spec.ts') ? durations.get('apps/gallery/shift.spec.ts') / Math.max(1, componentItems.length) : 30 })
const components = componentSelection.items
const gallerySpecs = batch ? [] : pending(gallerySpecItems)
const touchedComponents = new Set(componentItems.filter((item) => touches(item.inputs)).map((item) => item.id))
const galleryReason = (item) => {
  if (changed.includes(item.id)) return 'the spec changed'
  if (item.opens === '*') return 'it walks every component'
  const opened = item.opens.filter((name) => touchedComponents.has(name))
  return opened.length > 0 ? `it opens ${opened.join(', ')}` : 'what it reaches changed'
}
if (components.length > 0 || gallerySpecs.length > 0) {
  // Every component without GALLERY_SHIFT_ONLY is the heavy full walk: only the wide plan, or a change to the gallery harness.
  const all = components.length === componentItems.length && gallerySpecs.length === gallerySpecItems.length && (wide || heavyActive.has('gallery'))
  // Playwright reads each as an unanchored pattern: the slash keeps geometry.spec.ts from matching list-geometry.spec.ts.
  const specFiles = [...new Set([...(components.length > 0 ? ['/shift.spec.ts', '/computed-shift.spec.ts'] : []), ...gallerySpecs.map((item) => item.id.replace('apps/gallery', ''))])]
  plan.push({
    script: 'test:gallery',
    args: all ? [] : specFiles,
    // Partial gallery runs use four cores; the full suite needs eight.
    env: all || components.length === 0 ? undefined : { GALLERY_SHIFT_ONLY: components.map((item) => item.id).join(',') },
    items: [...components, ...gallerySpecs],
    why: all
      ? 'every component and behaviour spec'
      : `${components.length} component(s) in the shift guard${components.length ? `: ${components.map((item) => item.id).join(', ')}` : ''}${componentSelection.dropped.length ? `; ${componentSelection.dropped.length} more exceed the ${budget}-second estimate` : ''}; ${gallerySpecs.length} of ${gallerySpecItems.length} behaviour spec file(s)`,
    reasons: all ? undefined : gallerySpecs.map((item) => [item.id.replace('apps/gallery/', ''), [galleryReason(item)]]),
  })
}

// Desktop e2e, by spec file. Nearly every app file reaches the whole app
// through the import graph, so a change that reaches the app runs every spec.
// What every spec depends on: the app, and the fixtures, the driver, the build and Playwright configs, and what they reach (the fake Slack).
const { app, support } = desktopInputs(files, closure)
const specItems = [...files]
  .filter((file) => /^apps\/desktop\/e2e\/.*\.spec\.ts$/.test(file) && !/perf\.spec|screens\.spec|\/screens\//.test(file))
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

/**
 * Every spec (`{ all }`, with why) when the change reaches the desktop app,
 * what every spec compiles with, or shared e2e support no spec can be told
 * apart by; else `{ specs }`: the changed specs, those whose own helpers
 * changed, and those that use changed support (`reachSpecs`), with reasons.
 */
function desktopSelection() {
  if (everythingChanged.length > 0) return { all: `${everythingChanged[0]} changed` }
  const appFile = changed.find((file) => app.has(file))
  if (appFile !== undefined) return { all: `${appFile} is in the desktop app` }
  const specs = new Map()
  const add = (spec, reason) => specs.set(spec, [...(specs.get(spec) ?? []), reason])
  const own = (spec) => new Set([...closure(spec)].filter((file) => !app.has(file) && !support.has(file)))
  const changedSupport = changed.filter((file) => support.has(file))
  if (changedSupport.length > 0) {
    const reached = reach(changedSupport, own)
    if (reached === undefined || reached.size === 0) return { all: `${changedSupport.join(', ')} is shared e2e support every spec may reach` }
    for (const [spec, { reason }] of reached) add(spec, reason)
  }
  for (const item of specItems) for (const file of changed) if (own(item.id).has(file)) add(item.id, file === item.id ? 'the spec changed' : `its helper ${file} changed`)
  return { specs }
}

/** The specs that use the changed support (the driver, the fixtures, the fake Slack and OpenRouter), or undefined when a change cannot be placed. */
function reach(changedSupport, own) {
  if (argv.includes('--files')) return undefined
  const edits = changedSupport.filter((file) => SOURCE_FILE.test(file)).map((file) => ({ text: textAtChange(file), lines: changedLines(file) }))
  // A config, a page or a deleted file cannot be placed: every spec reaches it.
  if (edits.length < changedSupport.length || edits.some((edit) => edit.text === undefined)) return undefined
  const specTexts = new Map(specItems.map((item) => [item.id, [...own(item.id)].map((file) => readFileSync(join(root, file), 'utf8')).join('\n')]))
  const supportTexts = [...support].filter((file) => SOURCE_FILE.test(file)).map((file) => readFileSync(join(root, file), 'utf8'))
  return reachSpecs({ changed: edits, corpus: supportTexts, specTexts })
}
const SOURCE_FILE = /\.(ts|tsx|mts|mjs)$/
const selection = batch ? { specs: new Map() } : desktopSelection()
const desktopNotes = []
if (selection.specs) {
  // Named specs, guard specs and in a tool change one spec end to end run on top of the change's own picks.
  for (const spec of named.filter((file) => file.startsWith('apps/desktop/'))) selection.specs.set(spec, ['named with --spec', ...(selection.specs.get(spec) ?? [])])
  // A guard spec runs whenever a change is in its area (`GUARD_SPECS`).
  if (!batch) for (const guard of guardSpecsChanged(changed)) {
    if (!files.has(guard.spec)) continue
    selection.specs.set(guard.spec, [`${guard.file} is in its area: ${guard.guards}`, ...(selection.specs.get(guard.spec) ?? [])])
  }
  const smoke = 'apps/desktop/e2e/app.spec.ts'
  if (!batch && toolChanged.length > 0 && files.has(smoke) && !selection.specs.has(smoke))
    selection.specs.set(smoke, [`${toolChanged[0]} changed; one spec checks that a run still works (--wide runs everything)`])
}
// A spec whose every test is heavy runs only when its area changed.
const heavyOnly = new Set()
if (!wide) for (const area of HEAVY_AREAS.filter((entry) => !heavyActive.has(entry.area)))
  for (const spec of area.whole ?? []) {
    if (selection.specs ? !selection.specs.has(spec) : !files.has(spec)) continue
    heavyOnly.add(spec)
    desktopNotes.push(`${spec.replace('apps/desktop/', '')}: every test is @heavy (${area.area}); no changed file is in that area`)
  }
const smoke = 'apps/desktop/e2e/app.spec.ts'
if (!batch && toolChanged.length > 0 && files.has(smoke)) {
  const item = specItems.find((candidate) => candidate.id === smoke)
  item.own = true
  // A smoke run verifies the tools too; their contents must invalidate its cache.
  for (const file of git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'scripts')) item.inputs.add(file)
}
for (const item of specItems) if (named.includes(item.id)) item.force = true
const specs = pending(specItems.filter((item) => (selection.specs ? selection.specs.has(item.id) : true) && !heavyOnly.has(item.id)))
if (specs.length > 0) {
  const every = specs.length === specItems.length
  plan.push({
    script: 'test:desktop',
    args: every ? [] : specs.map((item) => item.id.replace('apps/desktop/', '')),
    // Heavy tests outside the change's areas are skipped by tag.
    env: Object.keys(skipEnv).length > 0 ? skipEnv : undefined,
    items: specs,
    why: selection.specs
      ? `${specs.length} of ${specItems.length} e2e spec file(s): the changed and named specs, and those that use changed e2e support`
      : `every desktop e2e spec: ${selection.all}`,
    reasons: selection.specs ? specs.map((item) => [item.id.replace('apps/desktop/', ''), selection.specs.get(item.id)]) : undefined,
  })
}

// A test file the change edits runs twice more, in one more step per lane: a new or changed test that passes only
// some of the time fails here, before it merges. Only for a change that edits a few test files: past that (a revamp of
// many tests) the reruns are skipped and named, and run with --rerun-changed once Tushar agrees (docs/development.md,
// "Rules for tests").
const RERUNS = 2
const RERUN_FILES_MAX = 10
const edited = (items) => items.filter((item) => changed.includes(item.id))
const editedTests = batch ? [] : [...edited(unitItems), ...edited(domItems), ...edited(specItems.filter((item) => !heavyOnly.has(item.id)))]
const rerun = (items) => pending(edited(items).map((item) => ({ ...item, suite: `repeat-${item.suite}`, own: true })))
if (editedTests.length > RERUN_FILES_MAX && !flag('--rerun-changed')) {
  desktopNotes.push(`reruns of changed test files skipped: ${editedTests.length} test files changed, over ${RERUN_FILES_MAX}; ask Tushar, then pass --rerun-changed`)
} else if (editedTests.length > 0) {
  const unitRepeat = rerun(unitItems)
  if (unitRepeat.length > 0) plan.push({ script: 'test', args: [`--rerun-each=${RERUNS}`, '--files', ...unitRepeat.map((item) => item.id)], items: unitRepeat, why: `${RERUNS} more runs of each unit test file the change edits` })
  const domRepeat = rerun(domItems)
  if (domRepeat.length > 0) plan.push({ script: 'test:dom', args: [`--rerun-each=${RERUNS}`, '--files', ...domRepeat.map((item) => item.id)], env: Object.keys(skipEnv).length > 0 ? skipEnv : undefined, items: domRepeat, why: `${RERUNS} more runs of each DOM test file the change edits` })
  const specRepeat = rerun(specItems.filter((item) => !heavyOnly.has(item.id)))
  if (specRepeat.length > 0) plan.push({ script: 'test:desktop', args: [...specRepeat.map((item) => item.id.replace('apps/desktop/', '')), `--repeat-each=${RERUNS}`], env: Object.keys(skipEnv).length > 0 ? skipEnv : undefined, items: specRepeat, why: `${RERUNS} more runs of each e2e spec the change edits` })
}

// The tool tests of the repository's scripts (scripts/affected-tests.mjs).
for (const { script, reached } of bunTestScripts(root, changed))
  if (everythingChanged.length > 0 || toolChanged.length > 0 || reached.length > 0)
    plan.push({ script, args: [], local: false, items: [], why: reached.length > 0 ? `${reached[0].file} ${reached[0].test === reached[0].file ? 'changed' : `reaches ${reached[0].test}`}${reached.length > 1 ? ` (and ${reached.length - 1} more)` : ''}` : 'the tools or dependencies changed' })
// An interaction with a budget whose own files changed: perf is suggested, and its feel scenario runs (feelScenarios; --wide, every one reached).
const interactions = batch ? [] : perfInteractionsChanged(changed)
const feel = pending(feelScenarios(batch ? [] : [...files], changed, interactions, (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '')).map(({ file, own }) => ({ suite: 'desktop', id: file, own, inputs: new Set([...app, ...support, ...closure(file)]) })).filter((item) => wide || item.own))
// A desktop step over every spec runs every project, so it already runs the feel scenarios unless their tag is skipped.
const everyFeel = plan.some((step) => step.script === 'test:desktop' && step.args.length === 0) && !skipTags.includes('@heavy-feel')
if (feel.length > 0 && !everyFeel) plan.push({ script: 'test:desktop', args: ['--project=feel', ...feel.map((item) => item.id.replace('apps/desktop/', ''))], local: false, items: feel, why: `${feel.length} feel scenario file(s): ${wide ? 'the change reaches them' : 'changed, their harness changed, or the scenario of a changed interaction'}` })
// --plan --json prints the plan for tools (a replay of past merges, for one).
if (flag('--json')) {
  writeFileSync(1, JSON.stringify({ changed, steps: plan.map((step) => ({ script: step.script, args: step.args, env: step.env, local: step.local === true, items: step.items.map((item) => item.id), why: step.why })), notes: desktopNotes, heavySkipped: skipTags }) + '\n')
  process.exit(0)
}
const scope = wide
  ? everythingChanged.length ? `; ${everythingChanged.join(', ')} changed, so everything runs` : ''
  : everythingChanged.length ? `; ${everythingChanged.join(', ')} changed, so every unit test and desktop spec runs, with a sample of the gallery (--wide: everything)` : ''
console.log(`affected: ${changed.length} changed file(s) since ${range ? range.join('..') : base.slice(0, 10)}${scope}${batch ? ' (the batch gate)' : ''}`)
for (const step of plan) {
  console.log(`  bun run ${step.script}${step.args.length ? ` ${step.args.length > 6 ? `${step.args.slice(0, 6).join(' ')} ... (${step.args.length} args)` : step.args.join(' ')}` : ''}${step.env ? ` with ${Object.entries(step.env).map(([key, value]) => `${key}=${value}`).join(' ')}` : ''}   # ${step.why}`)
  for (const [id, why] of step.reasons ?? []) console.log(`      ${id}: ${why[0]}${why.length > 1 ? ` (and ${why.length - 1} more)` : ''}`)
}
if (skipped > 0) console.log(`  (${skipped} item(s) skipped: they passed before with the same inputs; --no-cache runs them)`)
for (const note of desktopNotes) console.log(`  (${note})`)
if (!batch && skipTags.length > 0 && plan.some((step) => step.script === 'test:desktop' || step.script === 'test:dom')) console.log(`  (@heavy tests skipped: ${HEAVY_AREAS.filter((area) => area.suite === 'desktop' && !heavyActive.has(area.area)).map((area) => area.area).join(', ')}; no changed file is in their area. A full run (bun run verify:main) and --wide run them)`)
if (plan.length === 0) console.log('  nothing to run')
for (const entry of interactions)
  console.log(`  (${entry.interaction} has a perf budget and ${entry.files.length === 1 ? entry.files[0] : `${entry.files.length} of its files`} changed: bun run remote --cores 2 perf -g "${entry.perf}")`)
if (flag('--plan') || plan.length === 0) process.exit(0)

const results = await runPlan(plan, { root, local: flag('--local') })
mkdirSync(resultsDir, { recursive: true })
for (const { step, code, identity: actual } of results) if (code === 0 && sameIdentity(actual, identity)) for (const item of step.items) writeFileSync(join(resultsDir, item.key), `${item.suite} ${item.id}\n`)
console.log('affected: results')
for (const { step, code } of results) console.log(`  ${code === 0 ? 'passed' : `failed (${code})`}  bun run ${step.script}`)
process.exit(results.every(({ code }) => code === 0) ? 0 : 1)
