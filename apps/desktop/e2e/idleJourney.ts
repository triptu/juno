import { rm } from 'node:fs/promises'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { largeSeed, startFakeSlack, type FakeSlack } from '@juno/fake-slack'
import { Juno } from './driver/juno'
import { expect, hooks, launchApp, tempUserData, test, writeSlackApp, type RunningApp } from './fixtures'
import { answer, JunoChatPane } from './juno-agent/chat'

interface Reading {
  readonly kind: string
  readonly name: string
  readonly pid: number
  readonly cpu: number
  readonly memoryMb: number
}

const WINDOW_MS = 4_000
const SETTLE_MS = 1_000
// Every process, the window and GPU process included, at rest on Linux reads 0 to 1.2 % over 4 s, and the
// engine 3.7 % while the first sync waits (10-26). A spin of any size above that fails.
const BUDGET_PERCENT = 5
const MEMORY_GROWTH_MB = 96
const STEADY_GROWTH_MB = 32

async function reading(running: RunningApp, millis: number): Promise<ReadonlyArray<Reading>> {
  const start = await running.app.evaluate(() => (globalThis as unknown as { junoTest: { processSample: () => unknown } }).junoTest.processSample())
  await new Promise((resolve) => setTimeout(resolve, millis))
  return running.app.evaluate((_electron, before) => (globalThis as unknown as { junoTest: { processesSince: (sample: unknown) => ReadonlyArray<Reading> } }).junoTest.processesSince(before), start)
}

async function sample(running: RunningApp, state: string): Promise<ReadonlyArray<Reading>> {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  const values = await reading(running, WINDOW_MS)
  console.log(`idle resources, ${state}: ${JSON.stringify(values)}`)
  expect(values.length).toBeGreaterThan(0)
  for (const value of values) expect.soft(value.cpu, `${state}: ${value.name} at ${value.cpu.toFixed(1)} % of a core, budget ${BUDGET_PERCENT} %`).toBeLessThan(BUDGET_PERCENT)
  return values
}

function expectMemory(samples: ReadonlyArray<ReadonlyArray<Reading>>): void {
  for (const first of samples[0] ?? []) {
    const values = samples.map((sample) => sample.find((value) => value.pid === first.pid)?.memoryMb)
    expect(values.every((value) => value !== undefined), `${first.name}: process stayed alive`).toBe(true)
    const memory = values.filter((value) => value !== undefined)
    const growth = memory.at(-1)! - memory[0]!
    expect.soft(Math.max(...memory) - memory[0]!, `${first.name}: peak memory growth, MB`).toBeLessThan(MEMORY_GROWTH_MB)
    expect.soft(growth, `${first.name}: end minus start memory, MB`).toBeLessThan(MEMORY_GROWTH_MB)
    const steady = memory.slice(1).every((value, index) => value > memory[index]! + 2)
    expect.soft(steady && growth > STEADY_GROWTH_MB, `${first.name}: steady memory growth across states, ${memory.join(' → ')} MB`).toBe(false)
  }
}

/** A small real-process check. App diagnostics remain the primary evidence for idle spins in the field. */
export function portableIdleJourney(): void {
  test('idle resources while the first sync waits, after sync with a mention, in a topic and the Juno panel, and hidden', { tag: ['@heavy', '@heavy-idle'] }, async () => {
    test.setTimeout(90_000)
    const fake = await startFakeSlack({ seed: largeSeed({ topics: 200, messages: 2_000, users: 80, channels: { public: 12, private: 4, dms: 8, mpims: 4 } }) })
    const model = await startFakeOpenRouter({ answer })
    const userData = await tempUserData()
    const slackDir = await tempUserData()
    let running: RunningApp | undefined
    try {
      const slackApp = await writeSlackApp(fake, slackDir)
      running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, timing: 'production', fakeOpenRouterUrl: model.origin })
      await walk(running, fake)
    } finally {
      await running?.close()
      await fake.close()
      await model.close()
      await rm(userData, { recursive: true, force: true })
      await rm(slackDir, { recursive: true, force: true })
    }
  })
}

// The large seed's first public channel and two of its people.
const CHANNEL = 'C00000L'
const SENDER = 'U000001L'
const MENTIONED = 'U000002L'

/** A real mention (a rich_text `user` element), as Slack sends one. */
const mention = (fake: FakeSlack) =>
  fake.workspace.post({
    channel: CHANNEL,
    user: SENDER,
    mrkdwn: true,
    text: `<@${MENTIONED}> can you look at the rollout plan?`,
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'user', user_id: MENTIONED }, { type: 'text', text: ' can you look at the rollout plan?' }] }] }],
  } as Parameters<FakeSlack['workspace']['post']>[0])

async function walk(running: RunningApp, fake: FakeSlack): Promise<void> {
  const { app, win } = running
  const juno = new Juno(app, win)
  // The first sync waits on one conversation, so the sidebar's syncing card stays while it is sampled.
  fake.holdNext({ method: 'conversations.history' })
  await juno.signIn()
  await expect(juno.sidebar.syncStatus).toHaveText('Syncing with Slack', { timeout: 30_000 })
  await test.step('while the first sync waits on Slack', async () => { await sample(running, 'syncing card shown') })
  fake.release()
  await juno.waitForSync()
  await expect.poll(() => hooks(app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1400, 900))
  const samples = [await reading(running, 0)]
  console.log(`idle resources, baseline: ${JSON.stringify(samples[0])}`)
  expect(samples[0]!.map((value) => value.kind)).toEqual(expect.arrayContaining(['main', 'window', 'engine', 'agent']))
  await test.step('after sync, with an older unread message that mentions a known person', async () => {
    // The 10-16 case: an unread mention of someone the store knows, under a newer message that names nobody.
    mention(fake)
    fake.workspace.post({ channel: CHANNEL, user: SENDER, text: 'thanks, no rush' })
    await expect(juno.sidebar.row(`#${fake.workspace.conversation(CHANNEL)!.name}`).root).toContainText('thanks, no rush')
    samples.push(await sample(running, 'after sync'))
  })
  await test.step('an open topic', async () => {
    await juno.sidebar.rows.first().click()
    await expect(win.locator('[data-topic-view]').filter({ visible: true })).toBeVisible()
    samples.push(await sample(running, 'topic'))
  })
  await test.step('the Juno panel after a reply', async () => {
    await juno.tabs.menu('juno')
    const panel = JunoChatPane.panel(win)
    await panel.send('What needs attention?')
    await panel.expectJuno('You said: What needs attention?')
    samples.push(await sample(running, 'Juno panel'))
  })
  await test.step('the window hidden', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide())
    samples.push(await sample(running, 'hidden'))
  })
  expectMemory(samples)
}
