// Works out which tests a change can affect, and runs only those.
//
//   pnpm affected                 local Bun check, then the affected suites in one remote plan
//   pnpm affected --plan          print the plan only
//   pnpm affected --local         run the plan through the local root scripts
//   pnpm affected --local-on-outage   run the remote steps here if Namespace stays
//                                 unreachable for JUNO_REMOTE_OUTAGE_WAIT (default 10m here)
//   pnpm affected --base <ref>    compare with another ref (default: the merge base with main)
//   pnpm affected --plan --files packages/ui/src/Chip.tsx   plan for those files
//   pnpm affected --graph         pick desktop specs by the import graph, not the coverage map
//   pnpm affected --plan --range a..b   plan for what changed between two commits
//   pnpm affected --plan --json   the plan as JSON
//   pnpm affected --spec e2e/tabs.spec.ts   also run that spec (desktop or gallery; repeat or comma-separate)
//   pnpm affected --max-specs 20  allow more coverage-picked desktop specs (default 10)
//   pnpm affected --wide          the wide plan: every spec the change can reach, heavy tests included
//   pnpm affected --batch --base <ref>   the batch gate: unit tests, specs:check and conformance only
//
// The change is every file that differs from the merge base, committed or not,
// plus new files. An import graph over apps/ and packages/ (relative imports,
// @juno/* through each package's exports, named imports followed through
// barrel re-exports) decides what each change reaches; for desktop e2e specs
// the coverage map narrows it, and the plan runs the changed and named specs
// and at most 10 more, the most direct first (scripts/affected-select.mjs).
// Heavy tests, the Quint checks and the perf suggestion follow the areas in
// scripts/test-areas.mjs. The rules are in docs/development.md ("Affected
// tests"); --wide plans as before 10-18. scripts/affected-run.mjs runs the plan.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAP_PATH } from './coverage-map.mjs'
import { ImportGraph } from './import-graph.mjs'
import { driverSpecs, galleryComponents, mapProblem, MAX_COVERAGE_SPECS, rankSpecs, reachSpecs, selectSpecs } from './affected-select.mjs'
import { HEAVY_AREAS, heavyAreasChanged, inPaths, perfInteractionsChanged, PROTOCOL_PATHS } from './test-areas.mjs'
import { runPlan } from './affected-run.mjs'
import { nodeTestScripts, unitTestItems } from './affected-tests.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const values = (name) => argv.flatMap((arg, at) => (arg === name && at + 1 < argv.length ? argv[at + 1].split(',') : []))
const wide = flag('--wide')
const batch = flag('--batch')
const maxSpecs = argv.includes('--max-specs') ? Number(argv[argv.indexOf('--max-specs') + 1]) : MAX_COVERAGE_SPECS
/** At most this many gallery components go through the shift guard, unless the gallery harness changed. */
const MAX_SHIFT_COMPONENTS = 10
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
const changed = argv.includes('--files')
  ? argv[argv.indexOf('--files') + 1].split(',')
  : range
    ? git('diff', '--name-only', range[0], range[1])
    : [...new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')])].toSorted()
const files = new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages').filter((file) => existsSync(join(root, file))))

/** What every suite installs and compiles with: a change reaches every unit test, and a sample of every e2e suite. */
const dependencies = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'tsconfig.base.json']
/** The tools that plan and run the suites: a change runs the tool tests and one spec end to end (--wide: everything). */
const tools = ['scripts/affected.mjs', 'scripts/affected-select.mjs', 'scripts/affected-run.mjs', 'scripts/affected-tests.mjs', 'scripts/unit.mjs', 'scripts/plan.mjs', 'scripts/test-areas.mjs', 'scripts/import-graph.mjs', 'scripts/coverage-map.mjs', 'scripts/remote.mjs', 'scripts/heavy.mjs', 'scripts/build-cached.mjs', 'scripts/without-run-as-node.mjs']
const toolChanged = changed.filter((file) => tools.includes(file) || file.startsWith('scripts/remote/'))
const everythingChanged = [...changed.filter((file) => dependencies.includes(file)), ...(wide ? toolChanged : [])]

const graph = new ImportGraph(root, files)
const closure = (file) => graph.closure(file)
const resolveImport = (from, specifier) => graph.resolveImport(from, specifier)
const importers = (file) => graph.importers(file)

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
/** The items that need a run: their inputs changed (or everything did) and their key has not passed. A forced item (named with --spec) always runs. */
const pending = (items) =>
  items.filter((item) => {
    if (!(everythingChanged.length > 0 || item.own || item.force || touches(item.inputs))) return false
    item.key = keyOf(item.suite, item.id, item.inputs)
    if (item.force) return true
    if (passed(item.key)) skipped++
    return !passed(item.key)
  })

// Unit tests: the vitest files of every package and app (scripts/affected-tests.mjs).
const unitItems = unitTestItems(root, files, changed, closure)
const unit = pending(unitItems)
// Keep package identity all the way to Vitest. Relative filters used to run
// namesakes in unrelated packages and start every package's test process.
if (unit.length > 0) plan.push({ script: 'test', args: unit.length === unitItems.length ? [] : ['--files', ...unit.map((item) => item.id)], items: unit, why: `${unit.length} vitest file(s)` })

// Specs. specs:check keeps its own cache of passing Quint runs. A narrow plan
// adds it when the specs themselves changed, or what they run on (the lockfile
// carries the Quint version), not for the tools (the wide plan does).
const specChanges = changed.filter((file) => file.startsWith('specs/') && !file.endsWith('.md'))
if (everythingChanged.length > 0 || specChanges.length > 0) {
  const only = { 'specs/agent-memory.qnt': '--memory', 'specs/agent-actions.qnt': '--actions', 'specs/agent-recovery.qnt': '--recovery', 'specs/agent-recovery-replay.qnt': '--recovery' }
  const modes = new Set(specChanges.map((file) => only[file] ?? 'all'))
  const args = everythingChanged.length === 0 && modes.size === 1 && !modes.has('all') ? [...modes] : []
  plan.push({ script: 'specs:check', args, items: [], why: `${specChanges.length || 'shared'} spec input(s) changed${args.length ? `, ${args[0].slice(2)} only` : ''}` })
}

// Conformance: the outbox traces replayed against the engine (specs/README.md,
// "Conformance"). A narrow plan runs it when the code the specs model changed
// (PROTOCOL_PATHS: specs/, packages/sync/, the engine's outbox and send code);
// the wide plan when any file the replay reaches (425 of them) changed. The
// result is cached under every file the replay reaches either way.
const conformanceSpecs = ['specs/outbox.qnt', 'specs/outbox-conformance.qnt', 'specs/outbox-checks.mjs', 'specs/conformance.mjs', 'packages/engine/vitest.conformance.config.ts']
const protocolChanges = changed.filter((file) => inPaths(PROTOCOL_PATHS, file))
const conformanceItem = { suite: 'conformance', id: 'outbox', inputs: new Set([...closure('packages/engine/test/conformance/outbox.conformance.ts'), ...conformanceSpecs]) }
const conformanceDue = wide || everythingChanged.length > 0 || protocolChanges.length > 0
if (conformanceDue && pending([conformanceItem]).length > 0)
  plan.push({ script: 'specs:conformance', args: [], items: [conformanceItem], why: wide ? 'the outbox spec or the code its replay reaches changed' : `the code the specs model changed: ${protocolChanges.slice(0, 3).join(', ') || everythingChanged[0]}${protocolChanges.length > 3 ? ` and ${protocolChanges.length - 3} more` : ''}` })

// Specs named with --spec run whatever changed: e2e/tabs.spec.ts, apps/desktop/e2e/tabs.spec.ts or geometry.spec.ts (the gallery).
const named = values('--spec').map((spec) => {
  const found = [spec, `apps/desktop/${spec}`, `apps/desktop/e2e/${spec}`, `apps/gallery/${spec}`].find((path) => files.has(path) && path.endsWith('.spec.ts'))
  if (found === undefined) throw new Error(`--spec ${spec}: no desktop or gallery spec file at that path`)
  return found
})

// Heavy tests (@heavy) run only for an area a changed file (or a named spec) is in; the wide plan and the scheduled full run keep them all.
const heavyActive = new Set(wide ? HEAVY_AREAS.map((area) => area.area) : heavyAreasChanged([...changed, ...named]))
/** Playwright skips these tags (JUNO_SKIP_TAGS, read by each suite's config): the heavy areas this change does not reach. */
const skipTags = HEAVY_AREAS.filter((area) => area.suite === 'desktop' && !heavyActive.has(area.area)).map((area) => area.tag)
const skipEnv = skipTags.length > 0 ? { JUNO_SKIP_TAGS: skipTags.join(',') } : {}

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
let components = batch ? [] : pending(componentItems)
const gallerySpecs = batch ? [] : pending(gallerySpecItems)
// The shift guard over every component is heavy: a narrow plan walks at most
// MAX_SHIFT_COMPONENTS, ranked as desktop specs are (a changed file few
// components reach counts most, a component named like a changed file more).
let shiftDropped = 0
if (!wide && !heavyActive.has('gallery') && components.length > MAX_SHIFT_COMPONENTS) {
  const reach = (file) => componentItems.filter((item) => item.inputs.has(file)).length
  const changedWords = new Set(changed.map((file) => file.split('/').at(-1).replace(/(\.fixtures)?\.[a-z]+$/, '')))
  const score = (item) => changed.filter((file) => item.inputs.has(file)).reduce((sum, file) => sum + Math.log(componentItems.length / Math.max(reach(file), 1)), 0) + (changedWords.has(item.id) ? Math.log(componentItems.length) : 0)
  const ranked = components.map((item) => [item, score(item)]).toSorted((a, b) => b[1] - a[1] || a[0].inputs.size - b[0].inputs.size || a[0].id.localeCompare(b[0].id))
  shiftDropped = ranked.length - MAX_SHIFT_COMPONENTS
  components = ranked.slice(0, MAX_SHIFT_COMPONENTS).map(([item]) => item)
}
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
  const specFiles = [...(components.length > 0 ? ['/shift.spec.ts'] : []), ...gallerySpecs.map((item) => item.id.replace('apps/gallery', ''))]
  plan.push({
    script: 'test:gallery',
    args: all ? [] : specFiles,
    // Partial gallery runs use four cores; the full suite needs eight.
    env: all || components.length === 0 ? undefined : { GALLERY_SHIFT_ONLY: components.map((item) => item.id).join(',') },
    items: [...components, ...gallerySpecs],
    why: all
      ? 'every component and behaviour spec'
      : `${components.length} component(s) in the shift guard${components.length ? `: ${components.map((item) => item.id).join(', ')}` : ''}${shiftDropped ? ` (${shiftDropped} more reached; the full walk is @heavy)` : ''}; ${gallerySpecs.length} of ${gallerySpecItems.length} behaviour spec file(s)`,
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
  if (everythingChanged.length > 0) {
    if (wide) return { all: `${everythingChanged[0]} changed` }
    // What every spec compiles with changed: no spec can be told apart, so a sample stands in.
    const reason = `${everythingChanged[0]} changed`
    return { specs: new Map(specItems.map((item) => [item.id, [reason]])), scores: new Map(), required: new Set(), notes: [`${reason}: no spec can be told apart, so the smallest specs stand in for all of them`] }
  }
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
  // The support every spec shares (the driver, the fixtures, the fake Slack and OpenRouter), through which a change spreads.
  const supportTexts = [...support].filter((file) => SOURCE_FILE.test(file)).map((file) => readFileSync(join(root, file), 'utf8'))
  const reach = (changedSupport) => {
    if (argv.includes('--files')) return undefined
    const edits = changedSupport.filter((file) => SOURCE_FILE.test(file)).map((file) => ({ text: textAtChange(file), lines: changedLines(file) }))
    // A config, a page or a deleted file cannot be placed: every spec reaches it.
    if (edits.length < changedSupport.length || edits.some((edit) => edit.text === undefined)) return undefined
    return reachSpecs({ changed: edits, corpus: supportTexts, specTexts })
  }
  return selectSpecs({ specs: specItems.map((item) => item.id), changed, map, support, own, app, isNew: (file) => !existed.has(file), drift, importers, driver, narrow: !wide, reach })
}
const SOURCE_FILE = /\.(ts|tsx|mts|mjs)$/
const selection = batch ? { specs: new Map(), scores: new Map(), required: new Set(), notes: [] } : desktopSelection()
const desktopNotes = [...(selection.notes ?? [])]
let desktopDropped = []
if (!wide && selection.specs) {
  // Named specs, and in a tool change one spec end to end, run on top of the change's own picks.
  for (const spec of named.filter((file) => file.startsWith('apps/desktop/'))) {
    selection.specs.set(spec, ['named with --spec', ...(selection.specs.get(spec) ?? [])])
    selection.required.add(spec)
  }
  const smoke = 'apps/desktop/e2e/app.spec.ts'
  if (!batch && toolChanged.length > 0 && files.has(smoke) && !selection.specs.has(smoke)) {
    selection.specs.set(smoke, [`${toolChanged[0]} changed; one spec checks that a run still works (--wide runs everything)`])
    selection.required.add(smoke)
  }
  if (!batch && toolChanged.length > 0 && files.has(smoke)) {
    const item = specItems.find((candidate) => candidate.id === smoke)
    item.own = true
    // A smoke run verifies the tools too; their contents must invalidate its cache.
    for (const file of git('ls-files', '--cached', '--others', '--exclude-standard', '--', 'scripts')) item.inputs.add(file)
  }
  // A spec whose every test is heavy runs only when its area changed.
  for (const area of HEAVY_AREAS.filter((entry) => !heavyActive.has(entry.area)))
    for (const spec of area.whole)
      if (selection.specs.delete(spec)) desktopNotes.push(`${spec.replace('apps/desktop/', '')}: every test is @heavy (${area.area}); no changed file is in that area`)
  const sizes = new Map()
  const map = existsSync(join(root, MAP_PATH)) ? JSON.parse(readFileSync(join(root, MAP_PATH), 'utf8')) : { specs: [], files: {} }
  for (const at of Object.values(map.files).flat()) sizes.set(map.specs[at], (sizes.get(map.specs[at]) ?? 0) + 1)
  const ranked = rankSpecs({ specs: selection.specs, scores: selection.scores, required: selection.required, max: maxSpecs, size: (spec) => sizes.get(spec) ?? Infinity })
  selection.specs = ranked.specs
  desktopDropped = ranked.dropped
}
for (const item of specItems) if (named.includes(item.id)) item.force = true
// A narrow plan keeps the order picked: changed and named specs, then the most direct first.
const order = [...(selection.specs?.keys() ?? [])]
const chosen = selection.specs ? specItems.filter((item) => selection.specs.has(item.id)) : specItems
const specs = pending(wide ? chosen : chosen.toSorted((a, b) => order.indexOf(a.id) - order.indexOf(b.id)))
if (specs.length > 0) {
  const every = specs.length === specItems.length
  plan.push({
    script: 'test:desktop',
    args: every ? [] : specs.map((item) => item.id.replace('apps/desktop/', '')),
    // Heavy tests outside the change's areas are skipped by tag.
    env: Object.keys(skipEnv).length > 0 ? skipEnv : undefined,
    items: specs,
    why: selection.specs
      ? `${specs.length} of ${specItems.length} e2e spec file(s)${wide ? ', by the coverage map' : `: the changed and named specs, and the ${maxSpecs} that cover the change most directly`}`
      : `every desktop e2e spec: ${selection.all}`,
    reasons: selection.specs ? specs.map((item) => [item.id.replace('apps/desktop/', ''), selection.specs.get(item.id)]) : undefined,
  })
}

// The Node tests of the repository's scripts (scripts/affected-tests.mjs).
for (const { script, reached } of nodeTestScripts(root, changed))
  if (everythingChanged.length > 0 || toolChanged.length > 0 || reached.length > 0)
    plan.push({ script, args: [], local: true, items: [], why: reached.length > 0 ? `${reached[0].file} ${reached[0].test === reached[0].file ? 'changed' : `reaches ${reached[0].test}`}${reached.length > 1 ? ` (and ${reached.length - 1} more)` : ''}` : 'the tools or dependencies changed' })

// perf and feel are suggested only for an interaction with a budget whose own files changed.
const interactions = batch ? [] : perfInteractionsChanged(changed)

// --plan --json prints the plan for tools (a replay of past merges, for one).
if (flag('--json')) {
  writeFileSync(1, JSON.stringify({ changed, steps: plan.map((step) => ({ script: step.script, args: step.args, env: step.env, local: step.local === true, items: step.items.map((item) => item.id), why: step.why })), desktopDropped, notes: desktopNotes, heavySkipped: skipTags }) + '\n')
  process.exit(0)
}
const scope = wide
  ? everythingChanged.length ? `; ${everythingChanged.join(', ')} changed, so everything runs` : ''
  : everythingChanged.length ? `; ${everythingChanged.join(', ')} changed, so every unit test runs, with a sample of each e2e suite (--wide: everything)` : ''
console.log(`affected: ${changed.length} changed file(s) since ${range ? range.join('..') : base.slice(0, 10)}${scope}${batch ? ' (the batch gate)' : ''}`)
for (const step of plan) {
  console.log(`  pnpm ${step.script}${step.args.length ? ` ${step.args.length > 6 ? `${step.args.slice(0, 6).join(' ')} ... (${step.args.length} args)` : step.args.join(' ')}` : ''}${step.env ? ` with ${Object.entries(step.env).map(([key, value]) => `${key}=${value}`).join(' ')}` : ''}   # ${step.why}`)
  for (const [id, why] of step.reasons ?? []) console.log(`      ${id}: ${why[0]}${why.length > 1 ? ` (and ${why.length - 1} more)` : ''}`)
}
if (skipped > 0) console.log(`  (${skipped} item(s) skipped: they passed before with the same inputs; --no-cache runs them)`)
if (desktopDropped.length > 0) console.log(`  (${desktopDropped.length} more desktop spec(s) ran a changed file less directly; the scheduled full run covers them, --wide or --max-specs runs them)`)
for (const note of desktopNotes) console.log(`  (${note})`)
if (!batch && skipTags.length > 0 && plan.some((step) => step.script === 'test:desktop')) console.log(`  (@heavy tests skipped: ${HEAVY_AREAS.filter((area) => area.suite === 'desktop' && !heavyActive.has(area.area)).map((area) => area.area).join(', ')}; no changed file is in their area. The scheduled full run and --wide run them)`)
if (plan.length === 0) console.log('  nothing to run')
for (const entry of interactions)
  console.log(`  (${entry.interaction} has a perf budget and ${entry.files.length === 1 ? entry.files[0] : `${entry.files.length} of its files`} changed: on the Mac, pnpm perf -g "${entry.perf}"${entry.feel ? ` and pnpm test:feel ${entry.feel}` : ''})`)
if (flag('--plan') || plan.length === 0) process.exit(0)

const results = await runPlan(plan, { root, local: flag('--local'), localOnOutage: flag('--local-on-outage') })
mkdirSync(resultsDir, { recursive: true })
for (const { step, code } of results) if (code === 0) for (const item of step.items) writeFileSync(join(resultsDir, item.key), `${item.suite} ${item.id}\n`)
console.log('affected: results')
for (const { step, code } of results) console.log(`  ${code === 0 ? 'passed' : `failed (${code})`}  pnpm ${step.script}`)
process.exit(results.every(({ code }) => code === 0) ? 0 : 1)
