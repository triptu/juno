// Electron supervises a killed agent or engine and links the new process to the others: main
// brokers each port. Keep that, one durable input and one uncertain write here. The full point
// matrix runs in packages/agent/test/{actions,backup,redaction,turns}-crash.test.ts and recovery.test.ts.
import type { FakeLittlebird } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { CrashPoint } from '@juno/agent/crash'
import { Juno } from '../driver/juno'
import { hooks, launchApp, type LaunchOptions, type RunningApp } from '../fixtures'
import { addServer, agentReady, card, expectKilled, launchArmed, openChat, ready } from './agent'
import { answer as echo, expect, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

const NOTE = 'save a note about the address'

/**
 * "read eng <n>" reads #eng through the engine and says whether it found messages; the note request
 * proposes a Littlebird write; "forget my first message" proposes a removal; the rest is echoed.
 */
function answer(request: OpenRouterRequest): string | ToolCallAnswer {
  const read = /read eng (\d+)/.exec(request.input)?.[1]
  if (read !== undefined) {
    if (request.toolResult === undefined) return { toolCall: { name: 'slack_history', arguments: { channel: 'C0ENG' } } }
    return `<say>Read eng ${read}: ${request.toolResult.includes('(C0ENG)') ? 'found messages' : 'nothing'}</say>`
  }
  if (request.toolResult !== undefined) {
    if (request.toolResult.includes('Proposed Change card')) return '<say>The note is ready for you to review.</say>'
    if (request.toolResult.includes('Nothing is removed until')) return '<say>Ready to remove it.</say>'
    return `<say>Tool said: ${request.toolResult}</say>`
  }
  const server = /\bon (server-[0-9a-f-]+)/.exec(request.input)?.[1]
  if (server !== undefined && request.input.includes(NOTE)) {
    return { toolCall: { name: 'call_tool', arguments: { server, tool: 'add_material', args: { title: 'Launch', text: 'The launch moved to Tuesday.' } } } }
  }
  if (request.input.includes('forget my first message')) return { toolCall: { name: 'remove_messages', arguments: { messages: ['n1'] } } }
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

test.describe.configure({ timeout: 180_000 })

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

test('after the engine and then the agent are killed, main links each new process and the chat reads Slack again', async ({ userData, options }) => {
  await using(launchApp(userData, options), async (juno, { app }) => {
    await ready(juno)
    const chat = await openChat(juno)
    await chat.send('read eng 1')
    await chat.expectJuno('Read eng 1: found messages')

    // A new engine gets a new port to the running agent.
    const engine = await hooks(app, 'enginePid')
    if (engine === undefined) throw new Error('No engine process')
    process.kill(engine, 'SIGKILL')
    await expect.poll(() => hooks(app, 'enginePid'), { timeout: 15_000 }).not.toBe(engine)
    await expect.poll(() => hooks(app, 'engineState'), { timeout: 15_000 }).toBe('ready')
    await chat.send('read eng 2')
    await chat.expectJuno('Read eng 2: found messages')

    // A new agent gets new ports to the engine and to the renderer.
    const agent = await hooks(app, 'agentPid')
    if (agent === undefined) throw new Error('No agent process')
    process.kill(agent, 'SIGKILL')
    await expectKilled(app, agent)
    await agentReady(app)
    expect(await hooks(app, 'agentHost')).toBe('juno')
    await chat.send('read eng 3')
    await chat.expectJuno('Read eng 3: found messages')
    await expect(chat.junoBubble('Read eng 1: found messages')).toHaveCount(1)
  })
})

const MESSAGE_POINTS: ReadonlyArray<CrashPoint> = ['inbox.committed']

for (const point of MESSAGE_POINTS) {
  test(`a message sent as the agent dies at ${point} is kept and answered once after a relaunch`, async ({ userData, options }) => {
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
  await ready(juno)
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

test('a write that reached the server before the agent died is not sent again', async ({ userData, options, mcp }) => {
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
  await using(launchApp(userData, options), (juno) => expectChatIntact(juno, 'failed'))
  expect(mcp.materials()).toHaveLength(1)
})
