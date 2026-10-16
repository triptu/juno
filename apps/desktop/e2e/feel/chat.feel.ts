// The Juno chat: opening the Juno tab, the first bubble after a send, and
// opening the Juno panel beside a topic. The agent runs against the fake
// OpenRouter (`../juno-agent/chat.ts`).
import { test as agentTest } from '../juno-agent/chat'
import { expect, hooks } from '../fixtures'
import { happened, landsAndStays, neverBlank, noFlicker, noLayoutShift, switchesOnce } from './checks'
import { Feel } from './feel'
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
      ],
      regions: { chat: TAB },
      checks: [
        landsAndStays('composer', 'the composer', { from: 'press' }),
        switchesOnce('the header', (v) => String(v['header'] ?? 'none'), { from: 'press' }),
        noFlicker('chat', 'the chat', { from: 'press' }),
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
