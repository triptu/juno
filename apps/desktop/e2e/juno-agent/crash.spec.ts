// Electron supervises a killed agent or engine and links the new process to the others: main
// brokers each port. Keep that, in the one engine-restart journey, and one durable input and one
// uncertain write here. The uncertain write's clean relaunch also runs what else needs main's
// processes: a codemode script in the agent's utility process, and About's process table, the
// content-free diagnostics, log rotation and an unhandled rejection in main. The full point
// matrix runs in packages/agent/test/{actions,backup,redaction,turns}-crash.test.ts and recovery.test.ts.
import type { FakeLittlebird } from '@juno/agent-testing/mcp'
import type { Locator } from '@playwright/test'
import { SELF_ID, startFakeSlack, type FakeSlack } from '@juno/fake-slack'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { CrashPoint } from '@juno/agent/crash'
import { caughtUpSeed } from '../caughtUpSeed'
import { Juno } from '../driver/juno'
import { hooks, launchApp, type LaunchOptions, type RunningApp } from '../fixtures'
import { addServer, agentReady, card, expectKilled, launchArmed, openChat, ready, readySynced } from './agent'
import { codemode, codemodeAnswer, diagnostics, rejectionInMain, SCRIPT, seedFullLogs } from './processes'
import { answer as echo, expect, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

const NOTE = 'save a note about the address'

/**
 * "read eng <n>" reads #eng through the engine and says whether it found messages; the note request
 * proposes a Littlebird write; the rest is echoed.
 */
function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  const read = /read eng (\d+)/.exec(request.input)?.[1]
  if (read !== undefined) {
    if (request.toolResult === undefined) return { toolCall: { name: 'slack_history', arguments: { channel: 'C0ENG' } } }
    return `<say>Read eng ${read}: ${request.toolResult.includes('(C0ENG)') ? 'found messages' : 'nothing'}</say>`
  }
  if (request.input.includes(SCRIPT)) return codemodeAnswer(request)
  if (request.toolResult !== undefined) {
    if (request.toolResult.includes('Proposed Change card')) return '<say>The note is ready for you to review.</say>'
    return `<say>Tool said: ${request.toolResult}</say>`
  }
  const server = /\bon (server-[0-9a-f-]+)/.exec(request.input)?.[1]
  if (server !== undefined && request.input.includes(NOTE)) {
    return { toolCall: { name: 'call_tool', arguments: { server, tool: 'add_material', args: { title: 'Launch', text: 'The launch moved to Tuesday.' } } } }
  }
  return echo(request)
}

const test = base.extend<{ readonly model: ScriptedModel; readonly mcp: FakeLittlebird; readonly options: LaunchOptions }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startScriptedModel({ answer })
    await use(model)
    await model.close()
  },
  // oxlint-disable-next-line no-empty-pattern
  mcp: async ({}, use) => {
    const { startFakeLittlebird } = await import('@juno/agent-testing/mcp')
    const server = await startFakeLittlebird()
    await use(server)
    await server.close()
  },
  options: async ({ fake, slackApp, model }, use) => {
    await use({ fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, agent: true, fakeOpenRouterUrl: model.origin })
  },
})

/** Runs `f` on a launch and closes it however `f` ends. */
async function using<A>(launch: Promise<RunningApp>, f: (juno: Juno, running: RunningApp) => Promise<A>): Promise<A> {
  const running = await launch
  try {
    return await f(new Juno(running.app, running.win), running)
  } finally {
    await running.close()
  }
}

/** The chat after a run has ended: no status bubble. */
async function settled(chat: Awaited<ReturnType<typeof openChat>>): Promise<void> {
  await expect(chat.root.locator('[data-chat-status]')).toHaveCount(0, { timeout: 15_000 })
}

const KEY = 'fake-engine-test-key'

const restartTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: caughtUpSeed })
    await use(fake)
    await fake.close()
  },
})

/** What the restart journey's steps share. */
interface Journey {
  readonly juno: Juno
  readonly app: RunningApp['app']
  /** Posts a followed thread in #eng (Leo asks, you reply) and returns its sidebar row. */
  readonly post: (text: string) => Locator
  readonly calls: () => Promise<Record<string, number>>
  readonly badge: (text: string) => Promise<void>
  readonly clearBadge: () => Promise<void>
  /** Settings › Juno's line while no OpenRouter key is saved. */
  readonly missing: Locator
}

function journey(juno: Juno, app: RunningApp['app'], fake: FakeSlack): Journey {
  const settings = juno.win.getByRole('main')
  return {
    juno,
    app,
    post: (text) => {
      const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text })
      fake.workspace.post({ channel: 'C0ENG', user: SELF_ID, text: 'Looking.', threadTs: root.ts })
      return juno.win.locator(`[data-topic-row][data-topic-id="t:C0ENG:${root.ts}"]`)
    },
    calls: () => hooks(app, 'aiCalls'),
    badge: (text) => expect.poll(() => juno.dockBadge(), { timeout: 15_000 }).toBe(text),
    clearBadge: () => app.evaluate(() => (globalThis as unknown as { junoTest: { clearDockBadge: () => void } }).junoTest.clearDockBadge()),
    missing: settings.getByText('Topic art and AI titles need an OpenRouter key.'),
  }
}

async function noKeyNoCalls({ juno, calls }: Journey, first: Locator): Promise<void> {
  await expect(first).toBeVisible()
  await expect(first).toHaveAttribute('data-title-source', 'fallback')
  await expect(first.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'placeholder')
  await Promise.all([juno.workPass('title'), juno.workPass('art')])
  expect(await calls()).toEqual({})
}

async function saveKey({ juno, app, calls, missing }: Journey, first: Locator, engine: number): Promise<void> {
  await juno.openSettings('Juno')
  await expect(missing).toBeVisible()
  const settings = juno.win.getByRole('main')
  await settings.getByLabel('API key', { exact: true }).fill(KEY)
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(missing).toHaveCount(0)
  await expect(first).toHaveAttribute('data-title-source', 'ai', { timeout: 15_000 })
  await expect(first).toContainText('Postgres migration')
  await expect(first.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'art', { timeout: 15_000 })
  // Main counts a call from the engine's own message, which can come after the page shows the result.
  await expect.poll(async () => (await calls()).titleTopic ?? 0).toBeGreaterThan(0)
  await expect.poll(async () => (await calls()).topicArt ?? 0).toBeGreaterThan(0)
  await agentReady(app)
  expect(await hooks(app, 'enginePid')).toBe(engine)
}

async function beforeKill({ juno, badge, clearBadge }: Journey): Promise<void> {
  const chat = await openChat(juno)
  await chat.send('read eng 1')
  await chat.expectJuno('Read eng 1: found messages')
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  // Opening the row leaves the pointer on the list, which holds its order (SPEC 5).
  await juno.sidebar.leave()
  await juno.topic.composer.fill('Half a thought')
  await clearBadge()
  await badge('')
}

async function screenKept({ juno }: Journey): Promise<void> {
  await juno.topic.expectTitle('Main')
  await expect(juno.topic.composer).toHaveValue('Half a thought')
  await juno.sidebar.expectRows()
  await juno.sidebar.expectNoSyncStatus()
}

async function liveAndSend({ juno }: Journey, fake: FakeSlack): Promise<void> {
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Back after the restart.' })
  await juno.topic.expectMessage('Back after the restart.')
  await juno.topic.send('Half a thought')
  await juno.topic.expectSent('Half a thought')
}

async function aboutLive({ juno }: Journey): Promise<void> {
  await juno.openSettings('About')
  await expect(juno.settings.engineStatus).toHaveText('Engine live')
  await juno.settings.pingButton.click()
  await expect(juno.settings.root.getByText(/Pong \d+/)).toBeVisible()
}

async function agentRelinked({ juno, app }: Journey): Promise<void> {
  const chat = await openChat(juno)
  await chat.send('read eng 2')
  await chat.expectJuno('Read eng 2: found messages')
  const agent = await hooks(app, 'agentPid')
  if (agent === undefined) throw new Error('No agent process')
  process.kill(agent, 'SIGKILL')
  await expectKilled(app, agent)
  await agentReady(app)
  expect(await hooks(app, 'agentHost')).toBe('juno')
  await chat.send('read eng 3')
  await chat.expectJuno('Read eng 3: found messages')
  await expect(chat.junoBubble('Read eng 1: found messages')).toHaveCount(1)
}

async function removeKey({ juno, post, calls, missing }: Journey): Promise<void> {
  await juno.openSettings('Juno')
  await juno.win.getByRole('main').getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(missing).toBeVisible()
  const stopped = await calls()
  const afterRemoval = post('Redis replica. Investigate this new issue after removing the key.')
  await expect(afterRemoval).toBeVisible()
  await Promise.all([juno.workPass('title'), juno.workPass('art')])
  expect(await calls()).toEqual(stopped)
  await expect(afterRemoval).toHaveAttribute('data-title-source', 'fallback')
  await expect(afterRemoval.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'placeholder')
}

// The engine is killed once, and everything main must carry to the new one is checked after it: the AI key
// it reads from the keychain, the agent's and the window's ports, the window's own state and the dock dot.
// The engine's AI answers only with the key saved in Settings › Juno, as the live provider does. At the
// end main gives up on the engine twice: once undone by Restart in the sidebar, once for good.
restartTest('after one engine kill, main gives the new engine the AI key and its ports, the window keeps its topic and draft, and the dock dot comes back; Restart brings back an engine main gave up on', { tag: ['@heavy', '@heavy-crash'] }, async ({ userData, fake, slackApp, model }) => {
  const options = { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, fakeOpenRouterUrl: model.origin, fakeAiRequiresKey: true, aiJobs: true }
  await using(launchApp(userData, options), async (juno, { app }) => {
    const run = journey(juno, app, fake)
    const first = run.post('Postgres migration. We should plan the next steps together.')
    await juno.signIn()
    await juno.waitForSync()
    await juno.notificationHoursNow()
    // Maya's DM from before launch.
    await run.badge('•')
    await test.step('no key: the fallback title and the placeholder art, and no model call', () => noKeyNoCalls(run, first))
    const engine = await hooks(app, 'enginePid')
    if (engine === undefined) throw new Error('No engine process')
    await test.step('saving a key starts art, titles and the agent without restarting the engine or opening the topic', () => saveKey(run, first, engine))
    await test.step('before the kill: the chat reads Slack, #eng is open with a draft, and the dot is cleared', () => beforeKill(run))

    process.kill(engine, 'SIGKILL')
    await expect.poll(() => hooks(app, 'enginePid'), { timeout: 15_000 }).not.toBe(engine)
    await expect.poll(() => hooks(app, 'engineState'), { timeout: 15_000 }).toBe('ready')

    await test.step('nothing on screen was rebuilt: the tab, its draft and the rows are as they were', () => screenKept(run))
    await test.step('the new engine sets the dock dot again', async () => {
      await juno.waitForSync()
      await run.badge('•')
    })
    await test.step('the new engine’s port carries live updates and a send', () => liveAndSend(run, fake))
    await test.step('main sends the key again: a new topic gets its AI title', async () => {
      const afterRestart = run.post('Kafka retention. The consumer lag alert keeps firing overnight.')
      await expect(afterRestart).toHaveAttribute('data-title-source', 'ai', { timeout: 30_000 })
    })
    await test.step('About shows the engine live and it answers a ping', () => aboutLive(run))
    await test.step('the agent has a port to the new engine, and a killed agent gets new ports to the engine and the window', () => agentRelinked(run))
    await test.step('a wake sets a cleared dot again', async () => {
      await run.clearBadge()
      await run.badge('')
      await hooks(app, 'wake')
      await run.badge('•')
    })
    await test.step('removing the key stops new AI calls at once', () => removeKey(run))
    await test.step('the app is served from the juno: scheme, and nothing outside the renderer folder', async () => {
      expect(await juno.win.evaluate(() => `${location.protocol}//${location.host}${location.pathname}`)).toBe('juno://app/index.html')
      // A traversal attempt ends as a 404 (Chromium normalises the path; main refuses what is left).
      expect(await juno.win.evaluate(() => fetch('juno://app/../../package.json').then((r) => r.status, () => 'failed'))).toBe(404)
    })
    await test.step('an engine main gives up on clears the dot; the sidebar says so, and Restart brings it back', async () => {
      await run.badge('•')
      await juno.sidebar.expectNoSyncStatus()
      await hooks(app, 'failEngine')
      await run.badge('')
      // The rows stay; the line under the filters says what happened and offers the one action.
      await juno.sidebar.expectSyncStatus('Sync stopped')
      await juno.sidebar.expectRows()
      expect(await hooks(app, 'engineState')).toBe('failed')
      await juno.sidebar.restartButton.click()
      await juno.sidebar.expectNoSyncStatus(30_000)
      await expect.poll(() => hooks(app, 'engineState'), { timeout: 30_000 }).toBe('ready')
      await juno.expectEngineLive()
      await juno.sidebar.expectRows()
    })
    await test.step('About says so when the supervisor gives up again, and no restart is attempted', async () => {
      await juno.openSettings('About')
      await expect(juno.settings.engineStatus).toHaveText('Engine live')
      await hooks(app, 'failEngine')
      // The port closes; the renderer asks for a new one and is told there will be none.
      await expect(juno.settings.engineStatus).toHaveText('Engine failed', { timeout: 15_000 })
      expect(await hooks(app, 'engineState')).toBe('failed')
      expect(await hooks(app, 'enginePid')).toBeUndefined()
    })
  })
})

const MESSAGE_POINTS: ReadonlyArray<CrashPoint> = ['inbox.committed']

for (const point of MESSAGE_POINTS) {
  test(`a message sent as the agent dies at ${point} is kept and answered once after a relaunch`, { tag: ['@heavy', '@heavy-crash'] }, async ({ userData, options }) => {
    await using(launchArmed(userData, options, point, 2), async (juno, { app }) => {
      await ready(juno)
      const chat = await openChat(juno)
      await chat.send('earlier words')
      await chat.expectJuno('You said: earlier words')
      await settled(chat)
      const pid = await hooks(app, 'agentPid')
      await chat.send('what is on today?')
      await chat.expectOwner('what is on today?')
      await expectKilled(app, pid)
    })
    await using(launchApp(userData, options), async (juno) => {
      await juno.waitForSync()
      await agentReady(juno.app)
      const chat = await openChat(juno)
      await chat.expectJuno('You said: what is on today?')
      await settled(chat)
      for (const text of ['earlier words', 'what is on today?']) await expect(chat.ownerBubble(text)).toHaveCount(1)
      for (const text of ['You said: earlier words', 'You said: what is on today?']) await expect(chat.junoBubble(text)).toHaveCount(1)
      await expect(chat.root.locator('[data-chat-ending]')).toHaveCount(0)
    })
  })
}

/** Connects the fake Littlebird, has Juno propose a note, and clicks Add material with `point` armed. */
async function applyNote(juno: Juno, mcp: FakeLittlebird, app: RunningApp['app']): Promise<{ readonly pid: number | undefined }> {
  await readySynced(juno)
  const { id } = await addServer(juno, 'Notes', mcp.url)
  const chat = await openChat(juno)
  await chat.send(`${NOTE} on ${id}`)
  await chat.expectJuno('The note is ready for you to review.')
  const change = card(chat, 'change')
  await expect(change).toHaveAttribute('data-card-status', 'open')
  expect(mcp.materials()).toHaveLength(0)
  const pid = await hooks(app, 'agentPid')
  await change.getByRole('button', { name: 'Add material' }).click()
  return { pid }
}

/** After a clean relaunch the chat still has the exchange and the card as it settled. */
async function expectChatIntact(juno: Juno, status: 'done' | 'failed'): Promise<void> {
  await juno.waitForSync()
  await agentReady(juno.app)
  const chat = await openChat(juno)
  await expect(chat.ownerBubble(NOTE)).toHaveCount(1)
  await expect(chat.junoBubble('The note is ready for you to review.')).toHaveCount(1)
  await expect(card(chat, 'change')).toHaveCount(1)
  await expect(card(chat, 'change')).toHaveAttribute('data-card-status', status)
}

// Starts from the synced workspace (README, "Synced start"): sign-in is not what it checks.
test.extend({ synced: true })('a write that reached the server before the agent died is not sent again; after a clean relaunch a codemode script runs, and About shows every process and copies content-free diagnostics', async ({ userData, options, mcp, fake }) => {
  await seedFullLogs(userData)
  await using(launchArmed(userData, options, 'attempt.beforeReceipt'), async (juno, { app }) => {
    const { pid } = await applyNote(juno, mcp, app)
    await expectKilled(app, pid)
    expect(mcp.materials()).toHaveLength(1)
    await agentReady(app)
    const chat = await openChat(juno)
    // Juno cannot tell the write went through, so the card says Failed and offers nothing (SPEC 13.3).
    await expect(card(chat, 'change')).toHaveAttribute('data-card-status', 'failed', { timeout: 20_000 })
    await expect(card(chat, 'change').getByRole('button')).toHaveCount(0)
  })
  await using(launchApp(userData, { ...options, codemode: true }), async (juno, { app }) => {
    await expectChatIntact(juno, 'failed')
    await test.step('a read-only script runs in the agent process, its answer cites what it read, and Activity lists the read', () => codemode(juno, userData))
    await test.step('About shows every process, copies content-free diagnostics and rotates each process log', () => diagnostics(juno, app, fake, userData))
    await test.step('an unhandled rejection in main is logged with its stack, and the app keeps running', () => rejectionInMain(juno, app, userData))
  })
  expect(mcp.materials()).toHaveLength(1)
})
