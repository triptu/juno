// Test file reuse in full runs (docs/development.md, "Full runs"). A full run reuses a test file's pass from an
// earlier green full run when the file's inputs are unchanged, reruns a fresh random 20% of the files it could
// reuse, and reruns every file when the last fully fresh run is more than seven days old or with --no-cache. It
// covers the unit (engine flows included), DOM, browser and Electron lanes, a file at a time; the gallery, the spec
// check and conformance keep their own rules.
//
// A file's inputs are what `bun run affected` selects it by, made wider where the selection narrows: the whole
// modules it imports (bun test loads a barrel whole), the files and folders it names by path from its own folder,
// every data file of each package it reaches, the build its lane runs against, the app and e2e support every desktop
// spec reaches, and the harness (the lockfile, the root configs, the runner image and the scripts that set up and run
// the lanes). Each key also holds the lane's command words. A pass is reused only from a run with the same runtime
// and toolchain (Bun build, Node, Playwright, Chromium, Electron, OS, kernel, time zone, locale), as its jobs
// reported them.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { desktopInputs, domInputs, unitTestMatcher } from './affected-tests.mjs'
import { BuildGraph, buildInputs } from './build-inputs.mjs'
import { isDomTest } from './dom-tests.mjs'
import { sameIdentity } from './verify-inputs.mjs'
import { suitePassed } from './verify-repair.mjs'

/** The lanes whose files a full run reuses, by suite name. */
export const FILE_LANES = ['test', 'test:dom', 'test:browser', 'test:electron']
/** The share of reusable files each full run runs again. */
export const FILE_SAMPLE_SHARE = 0.2
/** How old the last fully fresh run may be before a full run reruns every file. */
export const freshFileDays = 7

const playwrightLanes = new Set(['test:browser', 'test:electron'])
const code = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|css|html)$/
// What sets up and runs every lane on the runner, followed through its imports, with every file of scripts/remote.
const harnessEntries = ['scripts/plan.mjs', 'scripts/remote.mjs', 'scripts/heavy.mjs', 'scripts/unit.mjs', 'scripts/dom-tests.mjs', 'scripts/build-cached.mjs',
  'scripts/build-desktop.mjs', 'scripts/without-run-as-node.mjs', 'scripts/check-bun.mjs', 'scripts/memory-budget.mjs', 'scripts/test-results-reporter.mjs',
  'scripts/verify-plan.mjs', 'scripts/verify-files.mjs']
const rootInputs = ['bun.lock', 'bunfig.toml', 'package.json', 'tsconfig.base.json']
// Playwright's config, its reporters and global setup, and the build steps every desktop lane runs first.
const playwrightEntries = ['apps/desktop/playwright.config.ts', 'apps/desktop/e2e/order.ts', 'apps/desktop/e2e/timings.ts', 'apps/desktop/e2e/feel/sheet.ts', 'apps/desktop/e2e/setup/web.setup.ts', 'apps/desktop/e2e/setup/electron.setup.ts']
const laneBuilds = { 'test:dom': 'dom/dist', 'test:browser': 'dist', 'test:electron': 'out' }

/** The whole-module graph a bundle sees, plus the files and folders a module names by path from its own folder. */
class TestGraph extends BuildGraph {
  importsOf(file) {
    if (this.parsed.has(file)) return this.parsed.get(file)
    const list = super.importsOf(file)
    if (!/\.(ts|tsx|mts|mjs|js|cjs)$/.test(file)) return list
    const text = readFileSync(join(this.root, file), 'utf8')
    const paths = []
    // new URL(`../../../specs/${name}`, import.meta.url): the folder before the first substitution.
    for (const match of text.matchAll(/new\s+URL\(\s*`([^`$]*)\$\{/g)) paths.push(match[1].replace(/[^/]*$/, ''))
    // join(import.meta.dirname, 'fixtures', 'recorded'), resolve(__dirname, '../out/.inputs-hash')
    for (const match of text.matchAll(/(?:join|resolve)\(\s*(?:import\.meta\.dirname|import\.meta\.dir|__dirname)((?:\s*,\s*['"][^'"\n]+['"])+)\s*[,)]/g))
      paths.push(join(...[...match[1].matchAll(/['"]([^'"\n]+)['"]/g)].map((part) => part[1])))
    const own = packageDir(file)
    for (const path of paths) {
      const target = normalize(join(dirname(file), path)).replace(/\/$/, '')
      // A path to the repository or the module's own package (a root to resolve from) names no input of its own.
      if (target === '.' || target.startsWith('..') || `${own}/`.startsWith(`${target}/`)) continue
      for (const found of this.under(target)) if (!list.some((entry) => entry.target === found)) list.push({ target: found, named: undefined, reexport: false })
    }
    return list
  }

  under(path) {
    if (this.files.has(path)) return [path]
    this.sorted ??= [...this.files].toSorted()
    return this.sorted.filter((file) => file.startsWith(`${path}/`))
  }
}

/** The package a file is in (`packages/engine`), or its top folder outside apps/ and packages/. */
const packageDir = (file) => /^(apps|packages)\//.test(file) ? file.split('/').slice(0, 2).join('/') : file.split('/')[0]

/** Each lane's test files at `root` (a checkout), with the inputs each one's key covers. */
export async function fileInventory(root, tracked) {
  const files = new Set(tracked.filter((file) => existsSync(join(root, file))))
  const graph = new TestGraph(root, files)
  const widened = () => new Set(graph.widened.map((reason) => reason.slice(0, reason.indexOf(': '))))
  const closure = (file) => graph.closure(file)
  const data = new Map()
  for (const file of files) if (/^(apps|packages)\//.test(file) && !code.test(file) && !file.endsWith('.md')) data.set(packageDir(file), [...(data.get(packageDir(file)) ?? []), file])
  const everything = new Map()
  for (const file of files) everything.set(packageDir(file), [...(everything.get(packageDir(file)) ?? []), file])
  /** A closure plus the data files of every package it reaches, and every file of a package a computed import makes unknowable. */
  const widen = (reached) => {
    const unknowable = widened()
    const out = new Set(reached)
    for (const dir of new Set([...reached].map(packageDir))) for (const file of data.get(dir) ?? []) out.add(file)
    for (const file of reached) if (unknowable.has(file)) for (const other of everything.get(packageDir(file)) ?? []) out.add(other)
    return out
  }
  const union = (...sets) => new Set(sets.flatMap((set) => [...set]))
  const harness = union(new Set(rootInputs.filter((file) => files.has(file))), new Set([...files].filter((file) => file.startsWith('scripts/remote/') && !/\.(test\.mjs|md)$/.test(file))),
    ...harnessEntries.filter((file) => files.has(file)).map(closure))
  const preload = (dir) => {
    const config = join(root, dir, 'bunfig.toml')
    const listed = existsSync(config) ? /^\s*preload\s*=\s*\[([^\]]*)\]/m.exec(readFileSync(config, 'utf8'))?.[1] ?? '' : ''
    return union(...[...listed.matchAll(/"([^"]+)"/g)].map((match) => normalize(join(dir, match[1]))).filter((file) => files.has(file)).map(closure))
  }
  const built = (outDir) => {
    const result = buildInputs(root, files, 'apps/desktop', outDir)
    return result.widened ? { files: new Set(files), extra: { widened: true } } : { files: new Set(result.files), extra: result.extra }
  }
  const lanes = Object.fromEntries(FILE_LANES.map((lane) => [lane, []]))
  const unitFiles = [...files].filter(unitTestMatcher(root)).toSorted()
  const rootPreload = preload('.')
  lanes.test = unitFiles.map((file) => ({ file, inputs: union(harness, rootPreload, preload(packageDir(file)), widen(closure(file))) }))
  const domFiles = [...files].filter(isDomTest).toSorted()
  if (domFiles.length > 0) {
    const build = built(laneBuilds['test:dom'])
    const shared = union(harness, preload('apps/desktop'), widen(domInputs(files, closure)), build.files)
    lanes['test:dom'] = domFiles.map((file) => ({ file, inputs: union(shared, widen(closure(file))), extra: build.extra }))
  }
  const specs = [...files].filter((file) => /^apps\/desktop\/e2e\/.*\.spec\.ts$/.test(file)).toSorted()
  if (specs.length > 0) {
    const { app, support } = desktopInputs(files, closure)
    const shared = union(harness, widen(app), widen(support), ...playwrightEntries.filter((file) => files.has(file)).map((file) => widen(closure(file))))
    // The browser lane runs the browser and feel projects: the spec files lanes.ts names, and the feel scenarios.
    const lanesFile = join(root, 'apps/desktop/e2e/lanes.ts')
    const browserSpecs = existsSync(lanesFile) ? (await import(lanesFile)).BROWSER_SPECS.map((spec) => `apps/desktop/e2e/${spec}`) : []
    const feel = [...files].filter((file) => /^apps\/desktop\/e2e\/feel\/[^/]+\.feel\.ts$/.test(file))
    // The Electron project runs every spec but the web shell's, the setup steps, perf and the screens.
    const electron = specs.filter((file) => !/^apps\/desktop\/e2e\/(web\/web-shell\.spec\.ts|setup\/|perf\.spec\.ts|[^/]*\.perf\.spec\.ts|screens\.spec\.ts|screens\/)/.test(file))
    for (const [lane, list] of [['test:browser', [...browserSpecs.filter((file) => files.has(file)), ...feel].toSorted()], ['test:electron', electron]]) {
      const build = built(laneBuilds[lane])
      lanes[lane] = list.map((file) => ({ file, inputs: union(shared, build.files, widen(closure(file))), extra: build.extra }))
    }
  }
  return lanes
}

/**
 * A full run's test lanes among `suites`: keys their files once in the checkout, then `plan` decides which run for a
 * toolchain and freshness and sets each lane's words to run only those. `files` is the last plan, by lane.
 */
export async function laneFiles({ root, checkout, commit, tracked, suites, records, identity, label }) {
  const lanes = suites.filter((suite) => FILE_LANES.includes(suite.name))
  const words = new Map(lanes.map((suite) => [suite.name, suite.words]))
  const inventory = lanes.length === 0 ? {} : await fileInventory(checkout, tracked)
  const keys = fileKeys(root, commit, Object.fromEntries(Object.entries(inventory).filter(([lane]) => words.has(lane))),
    Object.fromEntries(lanes.map((suite) => [suite.name, suite.words.filter((word) => !word.startsWith('--seed='))])))
  return {
    count: lanes.length,
    files: {},
    plan({ toolchain, fresh, seed }) {
      this.files = planFiles({ keys, sources: reuseSources(records, identity, toolchain), fresh, seed, source: label })
      for (const suite of lanes) suite.words = laneWords(suite.name, words.get(suite.name), this.files[suite.name])
      return this.files
    },
    reused() { return Object.values(this.files).some((lane) => lane.counts.reused > 0) },
    shares() { return Object.fromEntries(Object.entries(this.files).map(([lane, files]) => [lane, runShare(lane, files, records)])) },
    describe() { return Object.entries(this.files).map(([lane, files]) => describeFiles(lane, files)) },
  }
}

/** Each lane's files with their keys at `commit`: Git's blob ids of their inputs, the lane's words and the build's extra settings. */
export function fileKeys(root, commit, lanes, words = {}) {
  const listing = spawnSync('git', ['ls-tree', '-r', commit], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (listing.status !== 0) throw new Error(listing.stderr)
  const blobs = new Map(listing.stdout.trim().split('\n').map((line) => { const [entry, path] = line.split('\t'); return [path, entry.split(' ').at(-1)] }))
  return Object.fromEntries(Object.entries(lanes).map(([lane, items]) => [lane, new Map(items.map(({ file, inputs, extra }) => {
    const hash = createHash('sha256').update(JSON.stringify({ lane, file, words: words[lane] ?? [], extra: extra ?? null }))
    for (const input of [...inputs].toSorted()) hash.update(`\0${input}\0${blobs.get(input) ?? 'absent'}`)
    return [file, hash.digest('hex')]
  }))]))
}

/** The sample of `files` a seed picks for a lane: the first ceil(20%) by a hash of the seed, lane and file. */
export function samplePick(seed, lane, files, share = FILE_SAMPLE_SHARE) {
  const rank = (file) => createHash('sha256').update(`${seed}\0${lane}\0${file}`).digest('hex')
  return new Set([...files].toSorted((a, b) => rank(a).localeCompare(rank(b))).slice(0, Math.ceil(files.length * share)))
}

/** The runs a full run reuses passes from: green full runs that are not repairs, newest first. */
export const reuseSources = (records, identity, toolchain) => records.filter((record) => record.passed === true && record.smoke !== true && !record.repair
  && record.fileReuse && sameIdentity(record.identity, identity) && toolchain !== undefined && sameIdentity(record.toolchain, toolchain))

/**
 * Whether this full run reruns every file: with --no-cache, or when the last fully fresh run whose lanes passed (a
 * repair of one counts from the fresh run) finished more than seven days ago.
 */
export function freshFileRun(records, { noCache = false, now = Date.now() } = {}) {
  const runs = records.filter((record) => record.smoke !== true && record.fileReuse?.fresh === true
    && FILE_LANES.some((lane) => record.suites.some((suite) => suite.suite === lane))
    && record.suites.filter((suite) => FILE_LANES.includes(suite.suite)).every(suitePassed))
    .map((record) => record.fileReuse.at ?? record.finishedAt)
  const last = runs.toSorted().at(-1)
  const fresh = noCache || last === undefined || now - Date.parse(last) > freshFileDays * 24 * 60 * 60 * 1000
  return { fresh, last, reason: noCache ? '--no-cache' : last === undefined ? 'no fully fresh run on record' : fresh ? `the last fully fresh run finished ${last}` : undefined }
}

/**
 * Which files of each lane run, and why: every one when `fresh`; else those with no pass under their key in `sources`
 * (changed), the seed's sample of the rest (sampled), and the others reused from the run that ran them (`from`).
 */
export function planFiles({ keys, sources, fresh, seed, source }) {
  return Object.fromEntries(Object.entries(keys).map(([lane, laneKeys]) => {
    const entries = {}
    const reusable = []
    for (const [file, key] of laneKeys) {
      const found = fresh ? undefined : sources.map((record) => record.suites.find((suite) => suite.suite === lane)?.files?.entries?.[file]).find((entry) => entry?.key === key)
      entries[file] = found ? { key, ran: 'reused', from: found.from } : { key, ran: fresh ? 'fresh' : 'changed', from: source }
      if (found) reusable.push(file)
    }
    for (const file of fresh ? [] : samplePick(seed, lane, reusable)) entries[file] = { ...entries[file], ran: 'sampled', from: source }
    return [lane, { ...(fresh ? {} : { sample: seed }), ...countFiles(entries), entries }]
  }))
}

/** How many files ran because the run was fresh, because they changed, were sampled, or were reused, and from which runs. */
export function countFiles(entries) {
  const counts = { fresh: 0, changed: 0, sampled: 0, reused: 0 }
  const from = {}
  for (const entry of Object.values(entries)) {
    counts[entry.ran]++
    if (entry.ran === 'reused') from[entry.from] = (from[entry.from] ?? 0) + 1
  }
  return { counts, from }
}

/** The files of a lane that run. */
export const ranFiles = (files) => Object.entries(files.entries).filter(([, entry]) => entry.ran !== 'reused').map(([file]) => file).toSorted()

/** A lane's words with only its files that run: `--files` for bun test, file filters for Playwright, nothing when every file runs. */
export function laneWords(lane, words, files) {
  const ran = ranFiles(files)
  if (ran.length === Object.keys(files.entries).length) return words
  const at = words.indexOf(lane)
  // A spec can have no tests in a lane (a browser spec's Electron tests are only those tagged @electron or @canary).
  return playwrightLanes.has(lane) ? [...words.slice(0, at + 1), '--pass-with-no-tests', ...words.slice(at + 1), ...ran.map((file) => file.replace(/^apps\/desktop\//, ''))]
    : [...words, '--files', ...ran]
}

/** The files a lane's command runs, or undefined for every file. */
export function commandFiles(lane, words = []) {
  if (playwrightLanes.has(lane)) {
    const listed = words.slice(words.indexOf(lane) + 1).filter((word) => /\.(spec|feel)\.ts$/.test(word))
    return listed.length > 0 ? listed.map((file) => `apps/desktop/${file}`) : undefined
  }
  const at = words.indexOf('--files')
  return at === -1 ? undefined : words.slice(at + 1)
}

/** The share of a lane's work its running files make up: by their recorded test time in Playwright lanes, else by count. */
export function runShare(lane, files, records) {
  const ran = new Set(ranFiles(files))
  const total = Object.keys(files.entries).length
  if (total === 0) return 0
  const cases = playwrightLanes.has(lane) ? records.map((record) => record.suites.find((suite) => suite.suite === lane && suite.tests?.cases?.length && !suite.reusedFrom)).find(Boolean)?.tests.cases : undefined
  if (!cases) return ran.size / total
  const seconds = new Map()
  for (const test of cases) if (test.file in files.entries) seconds.set(test.file, (seconds.get(test.file) ?? 0) + test.durationMs)
  const all = [...seconds.values()].reduce((sum, value) => sum + value, 0)
  return all > 0 ? [...ran].reduce((sum, file) => sum + (seconds.get(file) ?? 0), 0) / all : ran.size / total
}

/**
 * What a job's `juno-toolchain:` line means for the run: `live`, the toolchain the jobs agree on; `failure` when a job
 * disagrees; `changed` (with its `fields`) when files are reused and the jobs' toolchain is not the one they passed on.
 */
export function checkToolchain(line, { live, expected, reused }) {
  const match = /^(?:\[runner:[^\]]+\] )?(?:\[[^\]]+\] )?juno-toolchain: (.+)$/.exec(line)
  if (!match) return undefined
  const reported = JSON.parse(match[1])
  if (live && !sameIdentity(reported, live)) return { live, failure: 'Jobs report different toolchains; stopped every job' }
  if (reused && !sameIdentity(reported, expected)) return { live: reported, changed: reported, fields: Object.keys(reported).filter((key) => reported[key] !== expected?.[key]) }
  return { live: reported }
}

/** The test files a lane's log or structured results name as failing. */
export function failingFiles(lane, log, tests) {
  if (tests?.cases) return new Set(tests.cases.filter((test) => test.outcome === 'unexpected' || test.attempts?.some((run) => run.status === 'interrupted')).map((test) => test.file).filter(Boolean))
  // bun test prints `<file>:` before each file's results and `(fail) <name>` for a failure, then the failures again under `N tests failed:`.
  const failing = new Set()
  let current
  for (const line of log.split('\n')) {
    if (/^\d+ tests? failed:$/.test(line)) break
    const header = /^(?:\.\/)?((?:apps|packages|dom)\/\S+\.test\.[cm]?[jt]sx?):$/.exec(line)
    if (header) current = header[1].startsWith('dom/') ? `apps/desktop/${header[1]}` : header[1]
    else if (line.startsWith('(fail) ') && current) failing.add(current)
  }
  return failing
}

/** One line per lane for the summary: what ran because it changed or was sampled, and what was reused from where. */
export function describeFiles(lane, files) {
  const { counts, from } = files
  if (counts.fresh > 0 || (counts.changed + counts.sampled + counts.reused === 0)) return `${lane}: every file (${counts.fresh}) ran fresh.`
  const sources = Object.entries(from).toSorted(([, a], [, b]) => b - a).map(([run, count]) => `${count} from ${run}`).join(', ')
  return `${lane}: ${counts.changed} ran because they changed, ${counts.sampled} sampled, ${counts.reused} reused${sources ? ` (${sources})` : ''}.`
}

/**
 * What is wrong with a full run's file counts, for the release gate: each lane must list its files, count them as its
 * entries say, sample what its seed picks from the files it could reuse, and run exactly the files its command names.
 * A repair keeps its own rules (the gate checks its baseline's counts).
 */
export function fileReuseProblems(record) {
  const reuse = record.fileReuse
  if (!reuse || record.repair) return []
  if (!reuse.fresh && (reuse.share !== FILE_SAMPLE_SHARE || !/^\d+$/.test(reuse.sample ?? ''))) return ['the record names no 20% file sample under a seed']
  const problems = []
  for (const suite of record.suites.filter((item) => FILE_LANES.includes(item.suite) && !item.reusedFrom)) {
    const lane = suite.suite
    const files = suite.files
    if (!files?.entries) { problems.push(`${lane} lists no files`); continue }
    const entries = Object.entries(files.entries)
    const counted = countFiles(files.entries)
    if (JSON.stringify(counted.counts) !== JSON.stringify(files.counts) || JSON.stringify(counted.from) !== JSON.stringify(files.from)) problems.push(`${lane}'s counts do not match its files`)
    if (reuse.fresh ? entries.some(([, entry]) => entry.ran !== 'fresh') || files.sample !== undefined
      : entries.some(([, entry]) => entry.ran === 'fresh') || files.sample !== reuse.sample) problems.push(`${lane}'s files do not match the run's ${reuse.fresh ? 'fresh rerun' : `sample seed ${reuse.sample}`}`)
    if (!reuse.fresh) {
      const reusable = entries.filter(([, entry]) => entry.ran === 'sampled' || entry.ran === 'reused').map(([file]) => file)
      const picked = samplePick(reuse.sample, lane, reusable)
      if (reusable.some((file) => picked.has(file) !== (files.entries[file].ran === 'sampled'))) problems.push(`${lane}'s sampled files are not the ones seed ${reuse.sample} picks`)
    }
    if (entries.some(([, entry]) => !entry.key || !entry.from)) problems.push(`${lane} has a file without its key or the run that ran it`)
    const listed = commandFiles(lane, suite.command)
    const ran = ranFiles(files)
    if (listed ? JSON.stringify([...new Set(listed)].toSorted()) !== JSON.stringify(ran) : ran.length !== entries.length) problems.push(`${lane}'s command does not run the files it counts as run`)
  }
  return problems
}
