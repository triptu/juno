import assert from 'node:assert/strict'
import { test } from 'node:test'
import { changedMembers, galleryComponents, rankSpecs, reachSpecs } from './affected-select.mjs'

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
  const reached = (lines) => reachSpecs({ changed: [{ text: DRIVER_TEXT, lines }], corpus: [DRIVER_TEXT], specTexts })
  assert.deepEqual([...reached([lineOf('getByRole')]).keys()], ['palette.spec.ts'])
  // press is used by Palette.pick, which pick.spec.ts calls.
  assert.deepEqual([...reached([lineOf('mouse.down')]).keys()], ['pick.spec.ts'])
})

test('the ranked plan keeps required items, then others within the time budget by score, then the smaller one', () => {
  const specs = new Map([['a', ['x']], ['b', ['x']], ['c', ['x']], ['d', ['x']]])
  const scores = new Map([['a', 0], ['b', 2], ['c', 0], ['d', 1]])
  const sizes = { a: 50, c: 10 }
  const ranked = rankSpecs({ specs, scores, required: new Set(['a']), budget: 120, size: (spec) => sizes[spec] ?? 0 })
  assert.deepEqual([...ranked.specs.keys()], ['a', 'b', 'd'])
  assert.deepEqual(ranked.dropped, ['c'])
  // A tie goes to the smaller item.
  assert.deepEqual([...rankSpecs({ specs, scores: new Map(), required: new Set(), budget: 60, size: (spec) => sizes[spec] ?? 99 }).specs.keys()], ['c'])
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
})
