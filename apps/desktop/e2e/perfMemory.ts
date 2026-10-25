import { writeFile } from 'node:fs/promises'
import { expect, type Locator, type Page } from '@playwright/test'
import type { Juno } from './driver/juno'
import { hooks, type RunningApp } from './fixtures'
import { privateMemory } from './perfStats'

/**
 * The heavy scenario's budgets (performance.md section 1), MB of private memory after its 30 s idle. The
 * renderer has 300 MB here, not the 250 MB of the scroll and memory scenario: after a scrolling peak Chromium
 * keeps the freed pages of its allocators, which nothing in the app holds (8.11, owner 10-18).
 */
export const HEAVY_MEMORY_BUDGETS = { main: 80, renderer: 300, engine: 300 } as const

export interface MemoryReading {
  /** Private memory per process, MB; undefined off macOS. */
  readonly main: number | undefined
  readonly renderer: number | undefined
  readonly engine: number | undefined
  readonly gpu: number | undefined
  readonly agent: number | undefined
  /** The renderer's JS heap, MB, and its DOM elements. */
  readonly heap: number
  readonly nodes: number
}

/** Each process's private memory, the renderer's JS heap and its DOM size, printed under `label`. */
export async function readMemory(running: RunningApp, label: string): Promise<MemoryReading> {
  const metrics = await running.app.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({ pid: metric.pid, type: metric.type })))
  const of = (pid: number | undefined) => (pid === undefined ? undefined : privateMemory(pid))
  const page = await running.win.evaluate(() => ({ heap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0, nodes: document.getElementsByTagName('*').length }))
  const reading: MemoryReading = {
    main: of(metrics.find((m) => m.type === 'Browser')?.pid),
    renderer: of(metrics.find((m) => m.type === 'Tab')?.pid),
    engine: of(await hooks(running.app, 'enginePid')),
    gpu: of(metrics.find((m) => m.type === 'GPU')?.pid),
    agent: of(await hooks(running.app, 'agentPid')),
    heap: page.heap / 1024 / 1024,
    nodes: page.nodes,
  }
  const mb = (value: number | undefined) => (value === undefined ? 'not read' : `${value.toFixed(0)} MB`)
  console.log(`${label}: private memory main ${mb(reading.main)}, renderer ${mb(reading.renderer)}, engine ${mb(reading.engine)}, GPU ${mb(reading.gpu)}, agent ${mb(reading.agent)}; renderer JS heap ${reading.heap.toFixed(1)} MB, ${reading.nodes} DOM elements`)
  return reading
}

/** Turns the wheel over `target`, `steps` steps of `delta` px, one a frame or so. */
async function wheel(win: Page, target: Locator, steps: number, delta: number): Promise<void> {
  const box = (await target.boundingBox())!
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let step = 0; step < steps; step++) {
    await win.mouse.wheel(0, delta)
    await win.waitForTimeout(20)
  }
}

/** What the heavy use works with: the app, and the lists and tabs it moves between. */
function heavyContext(juno: Juno, running: RunningApp) {
  const { win } = running
  // A topic's message list, not the Juno chat's, in the tab on screen.
  const scrollTopic = win.getByRole('main').locator('[data-topic-view] [data-scroll]:visible')
  const panel = win.locator('aside[data-juno-panel]')
  return {
    juno, running, win, scrollTopic, panel,
    chat: win.locator('main [data-juno-chat] [data-scroll]:visible'),
    // New tabs open beside the current one, so tabs are found by what they show, not by place.
    junoTab: juno.tabs.tab('Juno').first(),
    nextTopic: async () => {
      for (let tries = 0; tries < 3; tries++) {
        await juno.tabs.menu('next-tab')
        if (await scrollTopic.isVisible()) return
      }
      await expect(scrollTopic).toBeVisible({ timeout: 15_000 })
    },
    togglePanel: async () => {
      await juno.tabs.menu('juno')
      await expect(panel).toBeVisible()
      await juno.tabs.menu('juno')
      await expect(panel).toHaveCount(0)
    },
  }
}
type HeavyContext = ReturnType<typeof heavyContext>

/** Twenty topics, each in a new tab, as the owner opens them through a day; then fifty switches back and forth, so tabs leave the mounted set and come back. */
async function openAndSwitch(at: HeavyContext, start: number, topics: number, switches: number, phase: (name: string) => Promise<void>): Promise<void> {
  const { juno, win, scrollTopic } = at
  for (let i = 0; i < topics; i++) {
    await juno.tabs.menu('new-tab')
    await juno.tabs.expectCount(start + i + 1)
    const row = juno.sidebar.rows.nth(i)
    await row.scrollIntoViewIfNeeded()
    await row.click()
    await expect(scrollTopic).toBeVisible({ timeout: 15_000 })
  }
  await phase(`${topics} topics`)
  for (let i = 0; i < switches; i++) {
    await juno.tabs.menu(i % 10 < 7 ? 'next-tab' : 'previous-tab')
    await win.waitForTimeout(60)
  }
  await phase(`${switches} tab switches`)
}

/** The Juno chat in a tab of its own, given `messages` messages so it has history to scroll. */
async function fillChat(at: HeavyContext, start: number, messages: number): Promise<void> {
  const { juno, win } = at
  await juno.tabs.menu('new-tab')
  await juno.tabs.expectCount(start + 1)
  await win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const composer = win.locator('main [data-juno-chat] textarea:visible')
  await composer.waitFor()
  const answers = win.locator('main [data-juno-chat]:visible [data-chat-juno]')
  for (let i = 0; i < messages; i++) {
    const before = await answers.count()
    await composer.fill(`memory run ${i}: what changed in the sidebar?`)
    await composer.press('Enter')
    await expect.poll(() => answers.count(), { timeout: 15_000 }).toBeGreaterThan(before)
  }
}

/**
 * Scrolling for `scrollFor` ms, moving between the three lists: the sidebar, a topic's messages (the next
 * topic tab each round, mounted or not) and the Juno chat, with the panel opened and closed beside the topic.
 * Answers with how many times the panel opened.
 */
async function scrollRounds(at: HeavyContext, scrollFor: number): Promise<number> {
  const { juno, win, scrollTopic, chat, junoTab } = at
  // JUNO_MEMORY_PARTS=sidebar,topic,chat,switch keeps only those parts of each round, to find what a part costs. Diagnostic only.
  const parts = new Set((process.env['JUNO_MEMORY_PARTS'] ?? 'sidebar,topic,chat,switch').split(','))
  const until = Date.now() + scrollFor
  let panelOpens = 0
  for (let round = 0; Date.now() < until; round++) {
    const down = round % 2 === 0 ? 1 : -1
    if (parts.has('sidebar')) await wheel(win, juno.sidebar.list, 30, 300 * down)
    if (parts.has('switch') || round === 0) await at.nextTopic()
    if (parts.has('topic')) await wheel(win, scrollTopic, 30, -300 * down)
    if (parts.has('switch') && round % 2 === 0) {
      await at.togglePanel()
      panelOpens++
    }
    if (parts.has('chat')) {
      await junoTab.click()
      await chat.waitFor()
      await wheel(win, chat, 30, -300 * down)
      if (parts.has('topic') && !parts.has('switch')) await at.nextTopic()
    }
  }
  return panelOpens
}

/**
 * The large-workspace use the memory budgets assume (performance.md 1): 20
 * topics opened, each in a tab of its own, 50 tab switches, the Juno chat
 * given history, then about two minutes of scrolling that moves between the
 * sidebar, a topic's messages and the Juno chat, and the Juno panel opened
 * and closed beside a topic. Answers with the memory read after 30 s idle.
 */
export async function heavyUse(juno: Juno, running: RunningApp, { topics = 20, switches = 50, scrollFor = 120_000, chatMessages = 40, idle = 30_000 } = {}): Promise<MemoryReading> {
  const at = heavyContext(juno, running)
  const { win } = running
  const start = await juno.tabs.root.getByRole('tab').count()
  const dump = process.env['JUNO_MEMORY_DUMP']
  // After each part: private memory as it stands, and with JUNO_MEMORY_DUMP=<prefix> and JUNO_MEMORY_PHASES=1 a dump
  // as it stands and one after a collection, which changes what follows; without them only the end is dumped.
  const phase = async (name: string) => {
    await readMemory(running, `memory after ${name}`)
    if (dump === undefined || process.env['JUNO_MEMORY_PHASES'] !== '1') return
    await memoryDump(win, `${dump}-${name.replaceAll(' ', '-')}-live.json`, false)
    await memoryDump(win, `${dump}-${name.replaceAll(' ', '-')}.json`, true)
  }
  await openAndSwitch(at, start, topics, switches, phase)
  await fillChat(at, start + topics, chatMessages)
  await phase('the Juno chat')
  let panelOpens = await scrollRounds(at, scrollFor)
  await phase('scrolling')
  // The panel beside a topic, opened and closed at least ten times in all.
  await at.nextTopic()
  for (; panelOpens < 10; panelOpens++) await at.togglePanel()
  await readMemory(running, 'memory right after heavy use')
  // Then idle, as the owner stops to read: Chromium collects what rendering left behind once the page is quiet.
  await win.mouse.move(0, 0)
  await win.waitForTimeout(idle)
  if (dump !== undefined) await memoryDump(win, `${dump}-end-live.json`, false)
  return readMemory(running, 'memory after heavy use and 30 s idle')
}

/**
 * With JUNO_MEMORY_DUMP=<file>: a detailed Chromium memory-infra dump of
 * every process, as a trace, to find what holds native memory (tiles,
 * decoded images, the resource cache, Skia, the allocators). With
 * `collect`, garbage is collected first. Diagnostic only.
 */
export async function memoryDump(win: Page, file: string, collect = true): Promise<void> {
  const cdp = await win.context().newCDPSession(win)
  try {
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: ['disabled-by-default-memory-infra'] }, transferMode: 'ReturnAsStream' })
    await cdp.send('Tracing.requestMemoryDump', { deterministic: collect, levelOfDetail: 'detailed' })
    const done = new Promise<string>((resolve) => cdp.once('Tracing.tracingComplete', (event) => resolve(event.stream!)))
    await cdp.send('Tracing.end')
    const handle = await done
    const chunks: string[] = []
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle })
      chunks.push(chunk.base64Encoded === true ? Buffer.from(chunk.data, 'base64').toString() : chunk.data)
      if (chunk.eof) break
    }
    await cdp.send('IO.close', { handle })
    await writeFile(file, chunks.join(''))
  } finally {
    await cdp.detach()
  }
}
