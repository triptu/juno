import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeMappings, formatMap, mergePartials, sourceAt } from './coverage-map.mjs'
import { changedMembers, driverSpecs, galleryComponents, mapProblem, rankSpecs, reachSpecs, selectSpecs } from './affected-select.mjs'


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


test('coverage selection follows changed, new and unrecorded consumers without keeping deleted specs', () => {
  const cases = [
    [{ changed: ['packages/views/src/Topic.tsx'] }, [TOPIC]],
    [{ changed: ['packages/engine/src/sync.ts'] }, [SIDEBAR, TOPIC]],
    [{ changed: [TOPIC] }, [TOPIC]],
    [{ changed: ['apps/desktop/e2e/juno-agent/agent.ts'], specs: [SIDEBAR, TOPIC, AGENT] }, [AGENT]],
    [{ changed: ['packages/views/src/Topic.tsx'], specs: [SIDEBAR, TOPIC, AGENT] }, [AGENT, TOPIC]],
    [{ changed: ['packages/engine/src/sync.ts'], specs: [TOPIC] }, [TOPIC]],
    [{ changed: ['packages/views/src/types.ts'], specs: [SIDEBAR, TOPIC, AGENT] }, [AGENT]],
    [{ changed: ['docs/development.md'] }, []],
    [{ changed: ['packages/contract/src/schema.ts'], imports: { 'packages/views/src/Topic.tsx': ['packages/contract/src/schema.ts'] } }, [TOPIC]],
    [{ changed: ['packages/views/src/Badge.tsx'], added: ['packages/views/src/Badge.tsx', 'packages/views/src/BadgeRow.tsx'], imports: { 'packages/views/src/BadgeRow.tsx': ['packages/views/src/Badge.tsx'], 'packages/views/src/Sidebar.tsx': ['packages/views/src/BadgeRow.tsx'] } }, [SIDEBAR]],
  ]
  for (const [input, expected] of cases) assert.deepEqual([...select(input).specs.keys()].sort(), expected.sort(), JSON.stringify(input))
  const input = { changed: ['packages/views/src/Topic.tsx'], imports: { 'packages/views/src/Sidebar.tsx': ['packages/views/src/Topic.tsx'] } }
  assert.equal(select(input).specs.has(SIDEBAR), false)
  assert.equal(select({ ...input, drift: ['packages/views/src/Sidebar.tsx'] }).specs.has(SIDEBAR), true)
  for (const input of [
    { changed: ['packages/fake-slack/src/server.ts'] },
    { changed: ['packages/ui/src/fonts.css'] },
    { changed: ['packages/contract/src/schema.ts'] },
    { changed: ['packages/views/src/Orphan.tsx'], added: ['packages/views/src/Orphan.tsx'] },
  ]) assert.ok(select(input).all, JSON.stringify(input))
})

test('the map is not used when missing, of another version, from an unknown commit or too old', () => {
  const now = Date.parse(map.recordedAt)
  assert.equal(mapProblem(map, { now, commitKnown: true }), undefined)
  assert.match(mapProblem(undefined, { now, commitKnown: false }), /no coverage map/)
  assert.match(mapProblem({ ...map, version: 2 }, { now, commitKnown: true }), /version 2/)
  assert.match(mapProblem(map, { now, commitKnown: false }), /not in this repository/)
  assert.match(mapProblem(map, { now: now + 4 * 86_400_000, commitKnown: true }), /4 days old/)
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
