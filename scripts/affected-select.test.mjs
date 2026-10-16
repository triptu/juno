import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeMappings, formatMap, mergePartials, sourceAt } from './coverage-map.mjs'
import { changedMembers, driverSpecs, galleryComponents, mapProblem, MAX_MAP_AGE_DAYS, selectSpecs } from './affected-select.mjs'

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
