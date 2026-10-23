import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { decodeMappings, formatMap, mergePartials, sourceAt } from './coverage-map.mjs'
import { changedMembers, driverSpecs, galleryComponents, mapProblem, MAX_MAP_AGE_DAYS, rankSpecs, reachSpecs, selectSpecs } from './affected-select.mjs'
import { HEAVY_AREAS, heavyAreasChanged, inPaths, PERF_INTERACTIONS, perfInteractionsChanged, PROTOCOL_PATHS } from './test-areas.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

const TOPIC = 'apps/desktop/e2e/topic.spec.ts'
const SIDEBAR = 'apps/desktop/e2e/sidebar.spec.ts'
const AGENT = 'apps/desktop/e2e/juno-agent/hello.spec.ts'

const map = {
  version: 1,
  commit: 'abc',
  recordedAt: '2026-10-16T10:00:00.000Z',
  specs: [SIDEBAR, TOPIC],
  files: {
    'packages/views/src/Topic.tsx': [1],
    'packages/views/src/Sidebar.tsx': [0],
    'packages/engine/src/sync.ts': [0, 1],
    'apps/desktop/src/renderer/containers/topic.tsx': [1],
  },
  moduleOnly: ['packages/contract/src/schema.ts'],
}

/** A world with the files above in the app, and what a test changes on top. */
function select({ changed, imports = {}, added = [], drift = [], specs = [SIDEBAR, TOPIC] }) {
  const app = new Set([...Object.keys(map.files), ...map.moduleOnly, 'packages/views/src/types.ts', 'packages/ui/src/fonts.css', ...added, ...Object.keys(imports)])
  const importerMap = new Map()
  for (const [from, targets] of Object.entries(imports)) for (const target of targets) importerMap.set(target, [...(importerMap.get(target) ?? []), from])
  return selectSpecs({
    specs,
    changed,
    map,
    support: new Set(['apps/desktop/e2e/fixtures.ts', 'packages/fake-slack/src/server.ts']),
    own: (spec) => new Set(spec === AGENT ? [AGENT, 'apps/desktop/e2e/juno-agent/agent.ts'] : [spec]),
    app,
    isNew: (file) => added.includes(file),
    drift: new Set([...changed, ...drift]),
    importers: (file) => importerMap.get(file) ?? [],
  })
}

const picked = (result) => Object.fromEntries([...result.specs].map(([spec, reasons]) => [spec, reasons]))

test('a file the map knows picks the specs that ran it, with the reason', () => {
  assert.deepEqual(picked(select({ changed: ['packages/views/src/Topic.tsx'] })), { [TOPIC]: ['ran packages/views/src/Topic.tsx'] })
})

test('a file several specs ran picks each of them', () => {
  assert.deepEqual([...select({ changed: ['packages/engine/src/sync.ts'] }).specs.keys()].toSorted(), [SIDEBAR, TOPIC])
})

test('a changed spec or its own helper picks that spec only', () => {
  assert.deepEqual(picked(select({ changed: [TOPIC] })), { [TOPIC]: ['the spec changed'] })
  assert.deepEqual(picked(select({ changed: ['apps/desktop/e2e/juno-agent/agent.ts'], specs: [SIDEBAR, TOPIC, AGENT] })), { [AGENT]: ['its helper apps/desktop/e2e/juno-agent/agent.ts changed'] })
})

test('shared e2e support runs everything', () => {
  assert.deepEqual(select({ changed: ['packages/fake-slack/src/server.ts'] }), { all: 'packages/fake-slack/src/server.ts is shared e2e support' })
})

test('a file with module-level code only picks the specs that ran the files importing it', () => {
  const result = select({ changed: ['packages/contract/src/schema.ts'], imports: { 'packages/views/src/Topic.tsx': ['packages/contract/src/schema.ts'] } })
  assert.deepEqual(picked(result), { [TOPIC]: ['packages/contract/src/schema.ts has module-level code only; packages/views/src/Topic.tsx imports it and ran here'] })
})

test('a file with module-level code only that nothing known imports runs everything', () => {
  assert.match(select({ changed: ['packages/contract/src/schema.ts'] }).all, /module-level code only and nothing that imports it ran/)
})

test('an app file outside the bundles, such as a style sheet, runs everything', () => {
  assert.match(select({ changed: ['packages/ui/src/fonts.css'] }).all, /outside the JavaScript bundles/)
})

test('an app file that was in no bundle (types only) picks nothing but the specs without coverage', () => {
  assert.deepEqual(picked(select({ changed: ['packages/views/src/types.ts'], specs: [SIDEBAR, TOPIC, AGENT] })), { [AGENT]: ['no coverage recorded for it'] })
})

test('a file outside the app picks nothing', () => {
  assert.deepEqual(picked(select({ changed: ['packages/views/test/topic.test.ts', 'docs/development.md'], specs: [SIDEBAR, TOPIC, AGENT] })), {})
})

test('a new file picks the specs that ran the known files importing it, through other new files', () => {
  const result = select({
    changed: ['packages/views/src/Badge.tsx', 'packages/views/src/BadgeRow.tsx', 'packages/views/src/Sidebar.tsx'],
    added: ['packages/views/src/Badge.tsx', 'packages/views/src/BadgeRow.tsx'],
    imports: { 'packages/views/src/BadgeRow.tsx': ['packages/views/src/Badge.tsx'], 'packages/views/src/Sidebar.tsx': ['packages/views/src/BadgeRow.tsx'] },
  })
  assert.deepEqual(result.specs.get(SIDEBAR), [
    'packages/views/src/Badge.tsx is new; packages/views/src/Sidebar.tsx imports it and ran here',
    'packages/views/src/BadgeRow.tsx is new; packages/views/src/Sidebar.tsx imports it and ran here',
    'ran packages/views/src/Sidebar.tsx',
  ])
  assert.equal(result.specs.has(TOPIC), false)
})

test('a new file nothing known imports runs everything', () => {
  assert.match(select({ changed: ['packages/views/src/Orphan.tsx'], added: ['packages/views/src/Orphan.tsx'] }).all, /is new and nothing that imports it ran/)
})

test('an importer edited since the map adds its specs, as it may call the file now', () => {
  const result = select({ changed: ['packages/views/src/Topic.tsx'], drift: ['packages/views/src/Sidebar.tsx'], imports: { 'packages/views/src/Sidebar.tsx': ['packages/views/src/Topic.tsx'] } })
  assert.deepEqual(result.specs.get(SIDEBAR), ['packages/views/src/Sidebar.tsx imports packages/views/src/Topic.tsx and changed since the map'])
})

test('an importer unchanged since the map adds nothing', () => {
  const result = select({ changed: ['packages/views/src/Topic.tsx'], imports: { 'packages/views/src/Sidebar.tsx': ['packages/views/src/Topic.tsx'] } })
  assert.equal(result.specs.has(SIDEBAR), false)
})

test('a spec the map has no coverage for runs whenever the app changed', () => {
  assert.deepEqual(select({ changed: ['packages/views/src/Topic.tsx'], specs: [SIDEBAR, TOPIC, AGENT] }).specs.get(AGENT), ['no coverage recorded for it'])
})

test('a spec that no longer exists is never picked', () => {
  assert.deepEqual([...select({ changed: ['packages/engine/src/sync.ts'], specs: [TOPIC] }).specs.keys()], [TOPIC])
})

test('the map is not used when missing, of another version, from an unknown commit or too old', () => {
  const now = Date.parse(map.recordedAt)
  assert.equal(mapProblem(map, { now, commitKnown: true }), undefined)
  assert.match(mapProblem(undefined, { now, commitKnown: false }), /no coverage map/)
  assert.match(mapProblem({ ...map, version: 2 }, { now, commitKnown: true }), /version 2/)
  assert.match(mapProblem(map, { now, commitKnown: false }), /not in this repository/)
  assert.match(mapProblem(map, { now: now + (MAX_MAP_AGE_DAYS + 1) * 86_400_000, commitKnown: true }), /4 days old/)
})

test('source map segments decode to the file at a generated position', () => {
  // Line 0: column 0 from source 0, column 10 from source 1. Line 1: column 4 from source 1, column 8 unmapped.
  const lines = decodeMappings('AAAA,UCAA;IAAA,I')
  assert.equal(sourceAt(lines, 0, 3), 0)
  assert.equal(sourceAt(lines, 0, 10), 1)
  assert.equal(sourceAt(lines, 1, 2), -1)
  assert.equal(sourceAt(lines, 1, 5), 1)
  assert.equal(sourceAt(lines, 1, 9), -1)
  assert.equal(sourceAt(lines, 5, 0), -1)
})

test('partials join into one map: specs by index, files any spec ran, and bundled files none ran', () => {
  const merged = mergePartials(
    [
      { specs: { [TOPIC]: ['b.ts', 'a.ts'] }, bundled: ['a.ts', 'b.ts', 'c.ts'] },
      { specs: { [SIDEBAR]: ['a.ts'] }, bundled: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] },
    ],
    'abc',
    '2026-10-16T10:00:00.000Z',
  )
  assert.deepEqual(merged, { version: 1, commit: 'abc', recordedAt: '2026-10-16T10:00:00.000Z', specs: [SIDEBAR, TOPIC], files: { 'a.ts': [0, 1], 'b.ts': [1] }, moduleOnly: ['c.ts', 'd.ts'] })
  assert.deepEqual(JSON.parse(formatMap(merged)), merged)
})

const gallery = new Set(['Sidebar', 'TopicRow', 'AttachmentCard', 'Composer'])

test('a gallery spec opens the components it names, quoted or in an address', () => {
  const text = "await open(page, 'Sidebar', 'list/default')\nawait page.goto(`/TopicRow?__state=hierarchy/${state}`)\nawait page.goto('/#/AttachmentCard?__state=image')\nconst label = 'Send'"
  assert.deepEqual(galleryComponents(text, gallery), ['AttachmentCard', 'Sidebar', 'TopicRow'])
})

test('a gallery spec that reads every route, or names no component, walks every one', () => {
  assert.equal(galleryComponents("const routes = await readRoutes(page)\nawait open(page, 'Sidebar')", gallery), '*')
  assert.deepEqual(galleryComponents("const routes = (await readRoutes(page)).filter((route) => ['Composer'].includes(route.component))", gallery), ['Composer'])
  assert.equal(galleryComponents("await page.goto('/')", gallery), '*')
})

const DRIVER_TEXT = `import { type Page } from '@playwright/test'

export async function press(win: Page): Promise<void> {
  await win.mouse.down()
}

export class Palette {
  constructor(private readonly win: Page) {}

  /** The rows of one section. */
  section(name: string) {
    return this.win.getByRole('group', { name })
  }

  async pick(name: string) {
    await press(this.win)
  }
}

export class Sidebar {
  section(name: string) {
    return name
  }
}

export class Juno {
  get palette(): Palette {
    return new Palette(this.win)
  }
}
`
const lineOf = (text) => DRIVER_TEXT.split('\n').findIndex((line) => line.includes(text)) + 1

test('a driver change is placed in the class member or top-level function it falls in', () => {
  assert.deepEqual([...changedMembers(DRIVER_TEXT, [lineOf('getByRole')])], ['Palette.section'])
  assert.deepEqual([...changedMembers(DRIVER_TEXT, [lineOf('The rows of one section')])], ['Palette.section'])
  assert.deepEqual([...changedMembers(DRIVER_TEXT, [lineOf('mouse.down')])], ['press'])
  assert.deepEqual([...changedMembers(DRIVER_TEXT, [lineOf('constructor')])], ['Palette'])
  assert.deepEqual([...changedMembers(DRIVER_TEXT, [lineOf("from '@playwright/test'")])], [])
  assert.equal(changedMembers(DRIVER_TEXT, [lineOf('export class Palette')]), undefined)
})

test('a changed driver member reaches the specs that use it on its class, and through its callers', () => {
  const specTexts = new Map([
    ['palette.spec.ts', 'await juno.palette.section("Recent")'],
    ['sidebar.spec.ts', 'await juno.sidebar.section("Channels")'],
    ['pick.spec.ts', 'await juno.palette.pick("Home")'],
    ['other.spec.ts', 'await juno.topic.send("hi")'],
  ])
  const reached = (lines) => driverSpecs({ changed: [{ text: DRIVER_TEXT, lines }], driverTexts: [DRIVER_TEXT], specTexts })
  assert.deepEqual([...reached([lineOf('getByRole')]).keys()], ['palette.spec.ts'])
  // press is used by Palette.pick, which pick.spec.ts calls.
  assert.deepEqual([...reached([lineOf('mouse.down')]).keys()], ['pick.spec.ts'])
  assert.equal(reached([lineOf('export class Palette')]), undefined)
})

test('a driver change runs only the specs it reaches, and one outside a member runs everything', () => {
  const driverFile = 'apps/desktop/e2e/driver/juno.ts'
  const base = { specs: [SIDEBAR, TOPIC], map, support: new Set([driverFile]), own: (spec) => new Set([spec]), app: new Set(), isNew: () => false, drift: new Set(), importers: () => [] }
  const narrowed = selectSpecs({ ...base, changed: [driverFile], driver: () => new Map([[TOPIC, "it uses the driver's TopicPane.send, which changed or uses what changed"]]) })
  assert.deepEqual(picked(narrowed), { [TOPIC]: ["it uses the driver's TopicPane.send, which changed or uses what changed"] })
  assert.match(selectSpecs({ ...base, changed: [driverFile] }).all, /outside a named driver member/)
})

// Narrow selection (the default plan since 10-18; --wide keeps the rules above).

const COMMON = 'apps/desktop/e2e/common.spec.ts'
const wideMap = {
  ...map,
  specs: [SIDEBAR, TOPIC, COMMON],
  files: { ...map.files, 'packages/engine/src/boot.ts': [0, 1, 2], 'packages/views/src/Topic.tsx': [1] },
}
const narrowSelect = ({ changed, reach, imports = {}, specs = [SIDEBAR, TOPIC, COMMON] }) => {
  const importerMap = new Map()
  for (const [from, targets] of Object.entries(imports)) for (const target of targets) importerMap.set(target, [...(importerMap.get(target) ?? []), from])
  return selectSpecs({
    specs,
    changed,
    map: wideMap,
    support: new Set(['apps/desktop/e2e/fixtures.ts', 'packages/fake-slack/src/server.ts']),
    own: (spec) => new Set(spec === AGENT ? [AGENT, 'apps/desktop/e2e/juno-agent/agent.ts'] : [spec]),
    app: new Set([...Object.keys(wideMap.files), ...map.moduleOnly, 'packages/ui/src/fonts.css']),
    isNew: () => false,
    drift: new Set(changed),
    importers: (file) => importerMap.get(file) ?? [],
    narrow: true,
    reach,
  })
}

test('a file few specs ran counts more than one every spec runs', () => {
  const result = narrowSelect({ changed: ['packages/engine/src/boot.ts', 'packages/views/src/Topic.tsx'] })
  assert.equal(result.scores.get(TOPIC) > result.scores.get(SIDEBAR), true)
  assert.equal(result.scores.get(SIDEBAR), 0)
  // The strongest reason comes first, with how many specs ran the file.
  assert.equal(result.specs.get(TOPIC)[0], 'ran packages/views/src/Topic.tsx (run by 1 of 3 specs)')
})

test('a narrow selection never runs everything for support, a style sheet or an unplaced file', () => {
  const reached = narrowSelect({ changed: ['packages/fake-slack/src/server.ts'], reach: () => new Map([[TOPIC, { reason: 'it uses FakeSlack.react, which changed or uses what changed', depth: 0 }], [SIDEBAR, { reason: 'it uses test, which changed or uses what changed', depth: 3 }]]) })
  assert.equal(reached.all, undefined)
  assert.equal(reached.scores.get(TOPIC) > reached.scores.get(SIDEBAR), true)
  const unplaced = narrowSelect({ changed: ['apps/desktop/e2e/fixtures.ts'], reach: () => undefined })
  assert.deepEqual([...unplaced.specs.keys()], [SIDEBAR, TOPIC, COMMON])
  assert.match(unplaced.notes[0], /no spec can be told apart/)
  const css = narrowSelect({ changed: ['packages/ui/src/fonts.css'] })
  assert.equal(css.specs.size, 0)
  assert.match(css.notes[0], /outside the JavaScript bundles/)
  const orphan = narrowSelect({ changed: ['packages/contract/src/schema.ts'] })
  assert.equal(orphan.specs.size, 0)
  assert.match(orphan.notes[0], /nothing that imports it ran/)
})

test('a changed spec is required; specs importing a changed helper are ranked, not required', () => {
  const result = narrowSelect({ changed: [TOPIC, 'apps/desktop/e2e/juno-agent/agent.ts'], specs: [SIDEBAR, TOPIC, AGENT] })
  assert.deepEqual([...result.required], [TOPIC])
  assert.equal(result.scores.get(AGENT) > 1, true)
})

test('the ranked plan keeps required specs, then others within the time budget by score, then the smaller spec', () => {
  const specs = new Map([['a', ['x']], ['b', ['x']], ['c', ['x']], ['d', ['x']]])
  const scores = new Map([['a', 0], ['b', 2], ['c', 0], ['d', 1]])
  const sizes = { a: 50, c: 10 }
  const ranked = rankSpecs({ specs, scores, required: new Set(['a']), budget: 120, size: (spec) => sizes[spec] ?? 0 })
  assert.deepEqual([...ranked.specs.keys()], ['a', 'b', 'd'])
  assert.deepEqual(ranked.dropped, ['c'])
  // A tie goes to the spec that ran fewer files.
  assert.deepEqual([...rankSpecs({ specs, scores: new Map(), required: new Set(), budget: 60, size: (spec) => sizes[spec] ?? 99 }).specs.keys()], ['c'])
})

test('a cheap browser lane runs every reachable spec; an expensive optional spec cannot consume the required set', () => {
  const specs = new Map(Array.from({ length: 30 }, (_, index) => [`spec-${index}`, ['reached']]))
  const required = new Set(['spec-0'])
  const options = { specs, required, scores: new Map(), budget: 60 }
  assert.equal(rankSpecs({ ...options, seconds: () => 1 }).specs.size, 30)
  const bounded = rankSpecs({ ...options, seconds: (spec) => spec === 'spec-1' ? 90 : 10 })
  assert.ok(bounded.specs.has('spec-0'))
  assert.ok(!bounded.specs.has('spec-1'))
  assert.equal(bounded.specs.size, 7)
})

const FAKE_SERVER = `export class FakeServer {
  constructor(workspace: Workspace) {
    this.http = createServer((request, response) => this.#handle(request, response))
  }

  async #handle(request: Request, response: Response) {
    if (path === '/health') return json(response, 200)
  }
}

export const methods = {
  'conversations.history': history,
}
`
const FAKE_INDEX = `export class FakeSlack {
  static async start() {
    const server = new FakeServer(workspace)
  }

  react(name: string) {
    return name
  }
}

export function startFakeSlack() {
  return FakeSlack.start()
}
`
const fakeLine = (text) => FAKE_SERVER.split('\n').findIndex((line) => line.includes(text)) + 1

test('a fake Slack change reaches the specs that use it, nearest first, through a constructor', () => {
  const specTexts = new Map([
    ['start.spec.ts', 'const fake = await startFakeSlack()'],
    ['react.spec.ts', 'fake.react("eyes")'],
    ['history.spec.ts', "fake.holdNext({ method: 'conversations.history' })"],
  ])
  const reached = reachSpecs({ changed: [{ text: FAKE_SERVER, lines: [fakeLine("'/health'")] }], corpus: [FAKE_SERVER, FAKE_INDEX], specTexts })
  // #handle -> the constructor (FakeServer) -> FakeSlack.start -> startFakeSlack.
  assert.deepEqual([...reached.keys()], ['start.spec.ts'])
  assert.equal(reached.get('start.spec.ts').depth, 3)
  // A Slack method a changed line names reaches the specs that name it, at depth 0.
  const method = reachSpecs({ changed: [{ text: FAKE_SERVER, lines: [fakeLine("'conversations.history'")] }], corpus: [FAKE_SERVER, FAKE_INDEX], specTexts })
  assert.deepEqual(method.get('history.spec.ts'), { reason: "it uses the fake Slack's conversations.history, which changed", depth: 0 })
})

test('a support change outside every part counts as a change to what the file exports', () => {
  // A class's own line is outside every part (what it extends reaches every use).
  const text = 'export class Seeds extends Base {\n  grow() {}\n}\nexport function seed() {}\n'
  const reached = reachSpecs({ changed: [{ text, lines: [1] }], corpus: [text], specTexts: new Map([['seeded.spec.ts', 'seed()'], ['other.spec.ts', 'run()']]) })
  assert.deepEqual([...reached.keys()], ['seeded.spec.ts'])
  assert.equal(driverSpecs({ changed: [{ text, lines: [1] }], driverTexts: [text], specTexts: new Map() }), undefined)
})

test('heavy areas, protocol paths and perf interactions name files that exist, and each heavy tag is used', () => {
  const tracked = new Set(spawnSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).stdout.split('\n'))
  const strings = [...HEAVY_AREAS.flatMap((area) => [...area.paths, ...area.whole]), ...PROTOCOL_PATHS, ...PERF_INTERACTIONS.flatMap((entry) => entry.paths)].filter((path) => typeof path === 'string')
  for (const path of strings) assert.ok(path.endsWith('/') ? [...tracked].some((file) => file.startsWith(path)) : tracked.has(path), `${path} is not in the repository`)
  const specs = [...tracked].filter((file) => file.endsWith('.spec.ts')).map((file) => readFileSync(join(repo, file), 'utf8')).join('\n')
  for (const area of HEAVY_AREAS) assert.match(specs, new RegExp(`'${area.tag}'`), `no test is tagged ${area.tag}`)
  for (const entry of PERF_INTERACTIONS) if (entry.feel) assert.ok(tracked.has(`apps/desktop/e2e/feel/${entry.feel}`), entry.feel)
})

test('a change is in a heavy area, the protocol or an interaction by its own files only', () => {
  assert.deepEqual(heavyAreasChanged(['packages/sync/src/boot.ts']), ['sync'])
  assert.deepEqual(heavyAreasChanged(['apps/gallery/src/main.tsx', 'apps/gallery/geometry.spec.ts']), ['gallery'])
  assert.deepEqual(heavyAreasChanged(['apps/gallery/geometry.spec.ts', 'packages/views/src/Home.tsx']), [])
  assert.equal(inPaths(PROTOCOL_PATHS, 'specs/outbox.qnt'), true)
  assert.equal(inPaths(PROTOCOL_PATHS, 'specs/README.md'), false)
  assert.equal(inPaths(PROTOCOL_PATHS, 'packages/engine/src/home/rows.ts'), false)
  assert.deepEqual(perfInteractionsChanged(['packages/views/src/PeekView.tsx', 'docs/performance.md']).map((entry) => entry.interaction), ['peek'])
  assert.deepEqual(perfInteractionsChanged(['packages/views/src/SettingsPage.tsx']), [])
})
