// The timed perf budgets, on demand, under the exclusive heavy lock (docs/performance.md 7.3): on the laptop
// (`bun run remote --cores 2 perf ...`, one worker) against its baseline, on the Mac (or with JUNO_PERF_ABSOLUTE=1)
// against the absolute budgets. No full run includes them. By default only the small set that stands in for the
// rest (the scenarios tagged @proxy); the full set and focused subsets run when asked for.
//
//   bun run perf                          the small set (@proxy)
//   bun run perf --full                   every desktop scenario and the package budgets
//   bun run perf --area <area>            one area's scenarios and package budgets (AREAS below)
//   bun run perf -g "<scenario>"          matching desktop scenarios only
//   bun run perf --unit                   the package budgets only
//   bun run perf --with-unit -g "..."     both
//
// Outside the small set no metric has a laptop baseline: there it is printed and passes, and the Mac checks it.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Areas of the app, for an agent changing one area's hot path: a title pattern over the desktop scenarios, and the
 * package budget files that time the same work. `bun run affected` names finer patterns per interaction
 * (PERF_INTERACTIONS in scripts/test-areas.mjs).
 */
const AREAS = {
  startup: { grep: 'launch warm start|quick start|busiest channels|first open in a second app', unit: [] },
  sidebar: { grep: 'show the hidden sidebar|row hover|filter change|sidebar drag|scroll frame times|All topics', unit: ['topics-large'] },
  topic: { grep: 'topic open|topic reopen|peek|tab switch|live update|media viewer|jump into|scroll the 300', unit: ['messages-large'] },
  scroll: { grep: 'scroll|sidebar drag|drag a selection|jump into', unit: [] },
  composer: { grep: 'keystroke controls|typing|send', unit: [] },
  search: { grep: 'palette|search', unit: ['search-large', 'conversation-search-large'] },
  chat: { grep: 'Juno chat|Juno mention|drag a selection', unit: ['packages/agent/'] },
  home: { grep: 'home open|a new tab with Home', unit: [] },
  emoji: { grep: 'emoji', unit: [] },
  memory: { grep: 'memory', unit: [] },
}

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(name)
  if (at !== -1) args.splice(at, 1)
  return at !== -1
}
const option = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args.splice(at, 2)[1]
}
const unitsOnly = flag('--unit')
const withUnit = flag('--with-unit')
const full = flag('--full')
const areaName = option('--area')
const area = areaName === undefined ? undefined : AREAS[areaName]
if (areaName !== undefined && area === undefined) throw new Error(`--area is one of ${Object.keys(AREAS).join(', ')}`)
if ([unitsOnly, full, areaName !== undefined].filter(Boolean).length > 1) throw new Error('Use one of --unit, --full and --area')
if ((unitsOnly || full) && args.length > 0) throw new Error('--unit and --full take no grep')
if (area !== undefined) args.push('--grep', area.grep)
else if (!full && !unitsOnly && args.length === 0) args.push('--grep', '@proxy')
const runUnits = unitsOnly || full || withUnit || (area !== undefined && area.unit.length > 0)

/**
 * The package budgets: the agent's and the engine's `*.perf.ts` files, which bun test's default pattern skips,
 * so they are named one by one (repo paths).
 */
function unitPerfFiles() {
  const listed = (dir) => readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true }).map(String)
    .filter((file) => file.endsWith('.perf.ts')).toSorted().map((file) => `${dir}/${file}`)
  return [...listed('packages/agent/test'), ...listed('packages/engine/test/perf')]
}

const env = { ...process.env, JUNO_PERF: '1', JUNO_BENCH: '1', JUNO_BENCH_STRICT: '1' }
let failed = 0
if (runUnits) {
  const chosen = unitPerfFiles().filter((file) => area === undefined || area.unit.some((name) => file.includes(name)))
  // The large-seed budgets share one boot (packages/engine/test/perf/largeSeedEngine.ts), so they run in one process,
  // in bun's shuffled order; every other file runs alone.
  const shared = chosen.filter((file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes('largeSeedEngine'))
  const groups = [...(shared.length > 0 ? [shared] : []), ...chosen.filter((file) => !shared.includes(file)).map((file) => [file])]
  for (const files of groups) {
    const pkg = /^(packages\/[^/]+)\//.exec(files[0])?.[1]
    if (pkg === undefined || files.some((file) => !file.startsWith(`${pkg}/`))) throw new Error(`Not package budget files of one package: ${files.join(', ')}`)
    const result = spawnSync('bun', ['test', '--no-isolate', '--timeout', '600000', ...files.map((file) => `./${file.slice(pkg.length + 1)}`)], { cwd: `${root}${pkg}`, env, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.signal) process.exit(1)
    failed ||= result.status ?? 1
  }
}
if (!unitsOnly) {
  const result = spawnSync('bun', ['run', '--cwd', 'apps/desktop', 'perf', ...args], { cwd: root, stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.signal) process.exit(1)
  failed ||= result.status ?? 1
}
process.exitCode = failed
