// The Juno chat: opening the Juno tab, the first bubble after a send,
// opening the Juno panel beside a topic, and scrolling a long chat. The agent
// runs against the fake OpenRouter (`../juno-agent/chat.ts`).
import { startFakeOpenRouter, type OpenRouterRequest } from '@juno/agent-testing/openrouter'
import { answer, test as agentTest } from '../juno-agent/chat'
import { expect, hooks } from '../fixtures'
import { chart, drop } from '../attach'
import { keepsSize } from './answers'
import { contentHoldsStill, firstFrameRight, happened, landsAndStays, neverBlank, noFlicker, noLayoutShift, noLongFrames, scrollsOneWay, staysDrawn, switchesOnce } from './checks'
import { Feel } from './feel'
import { evenGaps } from './gaps'
import { Studio } from './studio'

// The feel fixtures of `./feel`, on the base that runs the agent.
const test = agentTest.extend<{ feel: Feel }, { studio: Studio }>({
  studio: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const studio = new Studio()
      await use(studio)
      await studio.close()
    },
    { scope: 'worker' },
  ],
  feel: async ({ win, studio }, use, info) => {
    await use(new Feel(win, studio, info.title))
  },
})

const POSTGRES = 'Draft plan is in the doc'
const TAB = 'main [data-juno-chat]'
const PANEL = 'aside[data-juno-panel]'

test('open the Juno tab, send, and the first bubble arrives', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')

  await feel.run(
    {
      name: 'juno-chat-open',
      title: 'Open the Juno tab from the sidebar: the chat shows whole, with its composer in place, in one step',
      probes: [
        { kind: 'rect', name: 'composer', selector: `${TAB} [data-juno-composer]` },
        { kind: 'text', name: 'header', selector: `${TAB} [data-juno-header]` },
        { kind: 'opacity', name: 'welcome', selector: `${TAB} [data-chat-empty] h1` },
      ],
      regions: { chat: TAB },
      checks: [
        landsAndStays('composer', 'the composer', { from: 'press' }),
        switchesOnce('the header', (v) => String(v['header'] ?? 'none'), { from: 'press' }),
        noFlicker('chat', 'the chat', { from: 'press' }),
        staysDrawn('welcome', 'the empty chat', { from: 'press' }),
      ],
    },
    async (rec) => {
      await rec.mark('press')
      await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
      await juno.win.locator(`${TAB} textarea`).waitFor()
    },
  )

  const composer = juno.win.locator(`${TAB} textarea`)
  await composer.fill('what is on today?')
  await feel.run(
    {
      name: 'juno-first-bubble',
      title: 'Send a message: your bubble shows at once, the dots follow, and Juno\'s bubble arrives whole without moving yours',
      probes: [
        { kind: 'box', name: 'owner', selector: `${TAB} [data-chat-owner]` },
        { kind: 'count', name: 'juno', within: TAB, selector: '[data-chat-juno]' },
        { kind: 'rect', name: 'composer', selector: `${TAB} [data-juno-composer]` },
      ],
      regions: { chat: `${TAB} [data-scroll]` },
      settleMs: 1200,
      checks: [
        happened('Juno answered', (r) => r.frames.some((f) => f.values['juno'] === 1)),
        landsAndStays('composer', 'the composer', { from: 'send' }),
        neverBlank('chat', 'the chat'),
        noFlicker('chat', 'the chat'),
        noLayoutShift({ from: 'send', region: 'chat', includeInput: true, warn: true }),
      ],
    },
    async (rec) => {
      await rec.mark('send')
      await composer.press('Enter')
      await juno.win.locator(`${TAB} [data-chat-juno]`).waitFor({ timeout: 15_000 })
    },
  )

})

test('react to a Juno bubble in the Juno tab', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const composer = juno.win.locator(`${TAB} textarea`)
  await composer.fill('what is on today?')
  await composer.press('Enter')
  await juno.win.locator(`${TAB} [data-chat-juno]`).waitFor({ timeout: 15_000 })

  const bubble = juno.win.locator(`${TAB} [data-chat-juno]`).first()
  await bubble.hover()
  await feel.run(
    {
      name: 'juno-react',
      title: "React to Juno's bubble: the quick reactions open at the React button and stay, and the badge lands on the bubble without moving anything",
      probes: [
        { kind: 'rect', name: 'reactions', selector: `${TAB} [data-juno-reactions]` },
        { kind: 'count', name: 'badge', within: TAB, selector: '[data-reactions]' },
      ],
      regions: { chat: `${TAB} [data-scroll]` },
      checks: [
        happened('the reaction showed', (r) => r.frames.some((f) => f.values['badge'] === 1)),
        landsAndStays('reactions', 'the quick reactions', { from: 'open' }),
        noFlicker('chat', 'the chat'),
        noLayoutShift({ from: 'open', region: 'chat', includeInput: true }),
      ],
    },
    async (rec) => {
      await rec.mark('open')
      await bubble.getByRole('button', { name: 'React' }).click()
      const thumbs = juno.win.locator(`${TAB} [data-juno-reactions]`).getByRole('button', { name: 'React 👍' })
      await thumbs.waitFor()
      await rec.mark('react')
      await thumbs.click()
      await juno.win.locator(`${TAB} [data-reactions]`).waitFor()
    },
  )
})

test('open the Juno panel beside a topic with ⌘J', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 900))
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectAtBottom()

  await feel.run(
    {
      name: 'juno-panel-open',
      title: 'Press ⌘J in a topic: the panel appears in one frame with its composer, and the topic reflows once',
      probes: [
        { kind: 'rect', name: 'panel', selector: PANEL },
        { kind: 'rect', name: 'composer', selector: `${PANEL} [data-juno-composer]` },
        { kind: 'rect', name: 'topic', selector: 'main [data-topic-view]' },
        { kind: 'opacity', name: 'emptyTitle', selector: `${PANEL} [data-chat-empty] h1` },
      ],
      regions: { panel: PANEL },
      checks: [
        landsAndStays('panel', 'the panel', { from: 'press' }),
        landsAndStays('composer', 'the panel composer', { from: 'press' }),
        switchesOnce('the topic width', (v) => JSON.stringify((v['topic'] as { width?: number } | null)?.width ?? null), { from: 'press' }),
        noFlicker('panel', 'the panel', { from: 'press' }),
        ({ recording }) => {
          // The empty chat lands with the panel: no entrance after the panel is up.
          const shown = recording.frames.filter((frame) => frame.values['panel'] !== null)
          const faded = shown.filter((frame) => frame.values['emptyTitle'] !== 1)
          const name = 'the empty chat lands with the panel'
          if (shown.length === 0) return { name, status: 'fail', detail: 'the panel never appeared', shots: [] }
          return { name, status: faded.length === 0 ? 'pass' : 'fail', detail: `${faded.length} of ${shown.length} frames with the panel had its title below full opacity`, shots: [] }
        },
      ],
    },
    async (rec) => {
      await rec.mark('press')
      await juno.tabs.menu('juno')
      await juno.win.locator(`${PANEL} textarea`).waitFor()
    },
  )
})

test('attach an image in the Juno tab and send it: the chip and the thumbnail keep their boxes', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const composer = juno.win.locator(`${TAB} [data-juno-composer]`)
  await composer.locator('textarea').waitFor()
  const CHIP = `${TAB} [data-juno-composer] [data-attachment]`

  await feel.run(
    {
      name: 'juno-image-attach',
      title: 'Drop an image on the Juno composer: its chip shows with the picture, in a box that never changes, and the field keeps its place',
      probes: [
        { kind: 'box', name: 'chip', selector: CHIP },
        { kind: 'images', name: 'chipImage', within: CHIP },
        { kind: 'text', name: 'state', selector: `${CHIP}[data-attachment="ready"]` },
        { kind: 'box', name: 'field', selector: `${TAB} [data-juno-composer] textarea` },
        { kind: 'rect', name: 'composer', selector: `${TAB} [data-juno-composer]` },
      ],
      regions: { composer: `${TAB} [data-juno-composer]` },
      checks: [
        happened('the chip got ready', (r) => r.frames.some((f) => f.values['state'] !== null)),
        landsAndStays('chip', 'the chip', { tolerance: 0 }),
        // The picture is in the chip from the frame the chip shows.
        firstFrameRight('the chip shows its picture in its first frame', (v) => v['chip'] !== null, (v) => (Number(v['chipImage']) > 0 ? null : 'no picture')),
        ({ recording }) => {
          // The composer grows up to make room for the chip: its bottom edge, where the field sits, stays.
          const boxes = recording.frames.map((f) => f.values['composer']).filter((v): v is { x: number; y: number; width: number; height: number } => typeof v === 'object' && v !== null && 'height' in v)
          const bottoms = new Set(boxes.map((b) => Math.round(b.y + b.height)))
          const name = "the composer's bottom edge stays"
          return { name, status: bottoms.size <= 1 ? 'pass' : 'fail', detail: `bottoms ${[...bottoms].join(', ')}`, shots: [] }
        },
        noFlicker('composer', 'the composer'),
      ],
    },
    async (rec) => {
      await rec.mark('drop')
      await drop(composer, [chart()])
      await juno.win.locator(`${CHIP}[data-attachment="ready"] img`).waitFor()
    },
  )

  const THUMB = `${TAB} [data-chat-owner] [data-owner-image="0"]`
  await feel.run(
    {
      name: 'juno-image-send',
      title: 'Send the image: the bubble shows with the picture\'s box reserved, the picture fills it without a move, and the chip leaves in one step',
      probes: [
        { kind: 'rect', name: 'thumb', selector: THUMB },
        { kind: 'images', name: 'thumbImage', within: THUMB },
        { kind: 'rect', name: 'owner', selector: `${TAB} [data-chat-owner]` },
        { kind: 'count', name: 'chips', within: TAB, selector: '[data-juno-composer] [data-attachment]' },
        { kind: 'rect', name: 'composer', selector: `${TAB} [data-juno-composer]` },
      ],
      regions: { chat: `${TAB} [data-scroll]` },
      settleMs: 1000,
      checks: [
        happened('the picture loaded in the bubble', (r) => r.frames.some((f) => Number(f.values['thumbImage']) > 0)),
        keepsSize('thumb', 'the picture'),
        // Juno's answer moves your bubble up the list; what must not change is its size as the picture loads.
        keepsSize('owner', 'your bubble'),
        switchesOnce('the chip', (v) => (Number(v['chips']) > 0 ? 'chip' : 'none'), { from: 'send' }),
        neverBlank('chat', 'the chat'),
        noFlicker('chat', 'the chat'),
      ],
    },
    async (rec) => {
      await rec.mark('send')
      await composer.locator('textarea').press('Enter')
      await juno.win.locator(`${THUMB} img`).waitFor({ timeout: 15_000 })
      await juno.win.locator(`${TAB} [data-chat-juno]`).waitFor({ timeout: 15_000 })
    },
  )
})

/** One long answer in numbered bubbles, as Juno splits one: short lines, a list, a long paragraph, code. */
const LONG_ANSWER = [
  'Here is the long version, in five parts.',
  '1. **The plan.** It has three phases:\n- A dual-write window where both schemas get every write\n- A backfill in 200-row batches, so the sync never blocks\n- A cutover that flips the read path behind a flag',
  '2. **The review.** Maya wants a reviewer for the backfill, because the index rebuild takes about forty minutes on the large workspace and the plan has it running inside the dual-write window. The flake on the sidebar test is unrelated: the fake server sometimes answers the second page before the first, and the test asserts on the order. Leo has a fix in a branch but has not opened the PR.',
  "3. **The lock waits.** Run this on staging:\n```\nSELECT pid, wait_event\nFROM pg_stat_activity\nWHERE state = 'active';\n```",
  '4. **What needs you.** Review `migrate.ts` before Thursday, and answer Leo about the cache TTL on staging, which he asked about twice this week.',
  '5. Nothing else needs you today.',
].map((text) => `<say>${text}</say>`)

/** Lets the last long answer go when the test says, then streams its bubbles 300 ms apart, as a model does. */
let releaseLast: () => void = () => {}

const longTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startFakeOpenRouter({
      answer: async (request: OpenRouterRequest) => {
        if (/\bonce more\b/.test(request.input)) {
          await new Promise<void>((resolve) => (releaseLast = resolve))
          return { chunks: LONG_ANSWER, gapMs: 300 }
        }
        return /\blong version\b/.test(request.input) ? LONG_ANSWER.join('') : answer(request)
      },
    })
    await use(model)
    await model.close()
  },
})

longTest('a long chat: jump to the bottom, then scroll up through it', async ({ juno, feel }) => {
  longTest.setTimeout(240_000)
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await juno.win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const composer = juno.win.locator(`${TAB} textarea`)
  const scroller = juno.win.locator(`${TAB} [data-scroll]`)
  const bubbles = juno.win.locator(`${TAB} [data-chat-juno]`)

  // Twelve long answers, each read as it lands at the bottom.
  for (let i = 0; i < 12; i++) {
    await composer.fill(`the long version, part ${i + 1}`)
    await composer.press('Enter')
    await expect(bubbles).toHaveCount((i + 1) * LONG_ANSWER.length, { timeout: 15_000 })
  }
  await expect(juno.win.getByTitle(/unread from Juno$/)).toHaveCount(0, { timeout: 10_000 })

  // One more lands while scrolled up, and only its first two bubbles are read, as when reading down into it.
  await composer.fill('the long version once more')
  await composer.press('Enter')
  await expect(juno.win.locator(`${TAB} [data-chat-owner]`).filter({ hasText: 'once more' })).toBeVisible()
  const box = (await scroller.boundingBox())!
  await juno.win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 8; i++) await juno.win.mouse.wheel(0, -300)
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(1500)
  releaseLast()
  await expect(bubbles).toHaveCount(13 * LONG_ANSWER.length, { timeout: 15_000 })
  await expect(juno.win.getByTitle('6 unread from Juno')).toBeVisible()
  await scroller.evaluate((el, count) => {
    const rows = [...el.querySelectorAll('[data-chat-juno]')]
    const second = rows.at(-count + 1)!
    el.scrollTop += second.getBoundingClientRect().bottom + 24 - el.getBoundingClientRect().bottom
  }, LONG_ANSWER.length)
  await expect(juno.win.getByTitle('4 unread from Juno')).toBeVisible({ timeout: 5_000 })

  const pill = juno.win.locator(TAB).getByRole('button', { name: /New message/ })
  await feel.run(
    {
      name: 'juno-long-chat-scroll',
      title: 'In a long chat read partway into the newest answer, jump to the bottom, then wheel up through it: bubbles of one answer stay 2 px apart in every frame, and nothing on screen moves on its own',
      probes: [
        { kind: 'rows', name: 'bubbles', scroller: `${TAB} [data-scroll]`, row: '[data-chat-juno]', part: '[data-chat-run]', key: 'data-chat-run' },
        { kind: 'edge', name: 'top', scroller: `${TAB} [data-scroll]`, rowKey: 'data-chat-juno', side: 'top' },
        { kind: 'scroll', name: 'scroll', selector: `${TAB} [data-scroll]` },
      ],
      regions: { chat: `${TAB} [data-scroll]` },
      checks: [
        happened('the jump reached the bottom', (r) => r.frames.some((f) => ((f.values['scroll'] as { fromBottom?: number } | null)?.fromBottom ?? Infinity) <= 2)),
        evenGaps('bubbles', 'bubbles of one answer', 2),
        contentHoldsStill('top', { from: 'landed', to: 'scroll' }),
        scrollsOneWay('top', 'up', { from: 'scroll' }),
        noLongFrames({ from: 'scroll' }),
        neverBlank('chat', 'the chat'),
        noFlicker('chat', 'the chat', { from: 'scroll' }),
      ],
    },
    async (rec) => {
      await rec.mark('jump')
      await pill.click()
      await juno.win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await rec.mark('landed')
      // Long enough for the bubbles in view to be read.
      await juno.win.waitForTimeout(1_800)
      await rec.mark('scroll')
      for (let i = 0; i < 40; i++) {
        await juno.win.mouse.wheel(0, -300)
        await juno.win.waitForTimeout(40)
      }
    },
  )
})
