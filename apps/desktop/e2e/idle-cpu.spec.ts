// Juno sleeps when nothing happens (performance.md section 1, "Idle CPU").
// On 10-18 a "Juno Helper" sat at 100 % of a core on the owner's Mac: the
// engine's send workers ran their pass again at once while a channel's first
// unsent row waited out a backoff. Every run counts the engine's work passes
// at rest under a test clock (packages/engine/test/flows/idle.flow.test.ts),
// and the Juno chat flow checks nothing on screen moves after an answer
// (juno.expectAtRest). The real-CPU check of that case is
// packages/engine/test/perf/edit-retry-idle.perf.ts.
//
// The portable walk (idleJourney.ts) runs on the laptop on demand
// (`bun run remote --env JUNO_ON_DEMAND=1 test:desktop e2e/idle-cpu.spec.ts`):
// every process of the real app in five states, including the 10-16 case of an
// unread mention of a known person. Every browser run also checks that Home and
// a topic run no frame loop, looping animation or timer loop (topic.spec.ts). The large-seed walk below keeps minute
// windows and the fine Mac budgets; it is @mac and runs only by hand, before
// a release that changes idle behaviour or when asked:
// `bun run test:desktop e2e/idle-cpu.spec.ts --grep @mac`. App diagnostics are
// the primary way to catch idle spins in the field.
import { rm } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { largeSeed, startFakeSlack, type FakeSlack } from '@juno/fake-slack'
import { Juno } from './driver/juno'
import { expect, hooks, launchApp, tempUserData, test, writeSlackApp, type RunningApp } from './fixtures'
import { answer, JunoChatPane } from './juno-agent/chat'
import { idleJourney } from './idleJourney'

const IDLE_WINDOW_MS = Number(process.env.JUNO_IDLE_WINDOW_MS ?? 60_000)

// A focused text field's native caret blinks at rest. Give only its Window
// 3%, rather than treating normal Mac text editing as an idle spin.
const FOCUSED_WINDOW_BUDGET = 3
const SYNC_SWEEP_ENGINE_BUDGET = 1
const SETTLE_MS = 10_000
const BUDGETS: Record<string, number> = { main: 2, window: 2, graphics: 2, engine: 3, agent: 2, network: 1, other: 1 }

interface Reading {
  readonly kind: string
  readonly name: string
  readonly type: string
  readonly pid: number
  readonly cpu: number
  readonly memoryMb: number
}

/** Each process's share of one core over `ms`, from main's process monitor. */
async function idleCpu(running: RunningApp, ms: number): Promise<ReadonlyArray<Reading>> {
  const sample = () => running.app.evaluate(() => (globalThis as unknown as { junoTest: { processSample: () => unknown } }).junoTest.processSample())
  const since = (before: unknown) =>
    running.app.evaluate((_electron, start) => (globalThis as unknown as { junoTest: { processesSince: (s: unknown) => ReadonlyArray<Reading> } }).junoTest.processesSince(start), before)
  const before = await sample()
  await new Promise((resolve) => setTimeout(resolve, ms))
  return since(before)
}

/** Measures `state`, printing readings and applying the Mac budgets. */
async function expectIdle(running: RunningApp, state: string, fake?: FakeSlack): Promise<void> {
  // Navigation leaves deferred cleanup; fine Mac budgets need ten seconds.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  const focusedTextField = await running.win.evaluate(() => {
    if (!document.hasFocus() || document.visibilityState !== 'visible') return false
    const active = document.activeElement
    return active instanceof HTMLElement && (active.isContentEditable || active.matches('textarea:read-write, input:read-write'))
  })
  const callsBefore = fake?.calls.length ?? 0
  let readings = await idleCpu(running, IDLE_WINDOW_MS)
  const calls = fake?.calls.slice(callsBefore) ?? []
  if (fake !== undefined && calls.length > 0) {
    // The full sequence reaches the normal ten-minute discovery sweep near
    // minimizing. Keep that busy sample visible, then measure actual idle.
    const busy = readings.map((r) => `${r.name} ${r.cpu.toFixed(1)}`).join(', ')
    const methods = [...new Set(calls.map((call) => call.method))].join(', ')
    console.log(`idle cpu, ${state}, busy sample (${methods}): ${busy}`)
    test.info().annotations.push({ type: 'busy cpu', description: `${state}: ${methods}; ${busy}` })
    expect(calls.some((call) => call.method === 'client.counts'), `${state}: only a discovery sweep may replace an idle window`).toBe(true)
    expect(calls.filter((call) => !call.ok), `${state}: Slack work must succeed`).toHaveLength(0)
    const engine = readings.find((reading) => reading.kind === 'engine')
    expect(engine?.cpu, `${state}: scheduled sync engine CPU, budget ${SYNC_SWEEP_ENGINE_BUDGET}%`).toBeLessThan(SYNC_SWEEP_ENGINE_BUDGET)
    await new Juno(running.app, running.win).expectEngineLive()
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    const retryCalls = fake.calls.length
    readings = await idleCpu(running, IDLE_WINDOW_MS)
    expect(fake.calls.slice(retryCalls).map((call) => call.method), `${state}: Slack must stay quiet throughout the replacement window`).toHaveLength(0)
  }
  const line = readings.map((r) => `${r.name} ${r.cpu.toFixed(1)}`).join(', ')
  console.log(`idle cpu, ${state} (${IDLE_WINDOW_MS / 1000} s, ${focusedTextField ? 'focused text field' : 'no focused text field'}): ${line}`)
  test.info().annotations.push({ type: 'idle cpu', description: `${state}: ${line}` })
  for (const reading of readings) {
    const budget = reading.kind === 'window' && focusedTextField ? FOCUSED_WINDOW_BUDGET : BUDGETS[reading.kind] ?? BUDGETS.other!
    expect.soft(reading.cpu, `${state}: ${reading.name} (${reading.type}, pid ${reading.pid}) at ${reading.cpu.toFixed(1)} % of a core, budget ${budget} %`).toBeLessThan(budget)
  }
}

/** Picks `label` from the switcher of the Juno header inside `where`. */
async function switchTo(win: Page, where: 'aside[data-juno-panel]' | 'main', label: string): Promise<void> {
  await win.locator(`${where} [data-juno-header] button[aria-haspopup="menu"]`).click()
  await win.getByRole('menu', { name: 'Juno pages' }).getByRole('menuitem', { name: label, exact: true }).click()
}

/** The Juno panel beside a topic with a long chat, Activity in it, then the Juno tab and its Activity, each after the last reply. */
async function junoStates(running: RunningApp, fake: FakeSlack): Promise<void> {
  const { win } = running
  const juno = new Juno(running.app, win)
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(win)
  for (let i = 0; i < 20; i++) {
    await panel.send(`question ${i} about the rollout`)
    await panel.expectJuno(`You said: question ${i} about the rollout`)
  }
  await win.mouse.move(400, 400)
  await expectIdle(running, 'the Juno panel, after a reply, 20 turns', fake)

  await switchTo(win, 'aside[data-juno-panel]', 'Activity')
  await expect(win.locator('aside[data-juno-panel] [data-juno-header="activity"]')).toBeVisible()
  await expectIdle(running, 'Activity in the panel', fake)
  await juno.tabs.menu('juno')

  await win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const tab = JunoChatPane.tab(win)
  await tab.composer.waitFor()
  await tab.send('one more question')
  await tab.expectJuno('You said: one more question')
  await expectIdle(running, 'the Juno tab, after a reply', fake)

  await switchTo(win, 'main', 'Activity')
  await expectIdle(running, 'Activity in a tab', fake)
}

/** Four more topics, each in a tab of its own; then the window minimized, and hidden. */
async function tabAndWindowStates(running: RunningApp, fake: FakeSlack): Promise<void> {
  const { app, win } = running
  const juno = new Juno(app, win)
  for (let i = 1; i <= 4; i++) {
    await juno.tabs.menu('new-tab')
    await juno.sidebar.rows.nth(i).click()
    await expect(win.locator('[data-topic-view]').filter({ visible: true })).toBeVisible({ timeout: 15_000 })
  }
  await win.mouse.move(900, 400)
  await expectIdle(running, 'several tabs', fake)

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.minimize())
  await expectIdle(running, 'window minimized', fake)
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.restore()
    window.hide()
  })
  await expectIdle(running, 'window hidden', fake)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.show())
}

test('idle resources while the first sync waits, after sync with a mention, in a topic and the Juno panel, and hidden', { tag: '@on-demand' }, idleJourney)

test.describe('mac process budgets', { tag: '@mac' }, () => {
  // The large seed with Juno on a fake model: each state is reached in turn
  // in one launch, as a person moves through the app.
  test('every process at rest on the large seed: Home, a topic, the Juno panel and tab, Activity, several tabs, minimized and hidden', async () => {
    test.setTimeout(20 * IDLE_WINDOW_MS + 600_000)
    const fake = await startFakeSlack({ seed: largeSeed() })
    const model = await startFakeOpenRouter({ answer })
    const userData = await tempUserData()
    const slackDir = await tempUserData()
    let running: RunningApp | undefined
    try {
      const slackApp = await writeSlackApp(fake, slackDir)
      running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin })
      const { app, win } = running
      const juno = new Juno(app, win)
      await juno.signIn()
      await juno.sidebar.expectRows()
      // The large seed's first sync takes a few minutes on a laptop.
      await juno.expectEngineLive(300_000)
      await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 900))
      await win.mouse.move(900, 400)
      await expectIdle(running, 'Home', fake)

      await juno.sidebar.rows.nth(0).click()
      await expect(win.locator('[data-topic-view]').filter({ visible: true })).toBeVisible({ timeout: 15_000 })
      await win.mouse.move(900, 400)
      await expectIdle(running, 'a topic', fake)

      await juno.topic.composer.focus()
      await expect(juno.topic.composer).toBeFocused()
      await expectIdle(running, 'a topic with its composer focused', fake)

      await junoStates(running, fake)
      await tabAndWindowStates(running, fake)
    } finally {
      await running?.close()
      await fake.close()
      await model.close()
      await rm(userData, { recursive: true, force: true })
      await rm(slackDir, { recursive: true, force: true })
    }
  })
})
