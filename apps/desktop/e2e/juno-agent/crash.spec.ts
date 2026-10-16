// The crash harness (plan v3 §16): the agent process kills itself at a named crash point
// (`packages/agent/src/runtime/crash.ts`), comes back, and the owner checks the chat. No outward
// action repeats, open cards come back in the right state, and the chat is intact.
//
// Main restarts a killed agent at once with the same crash point armed, so a point the
// restarted agent reaches again kills it again. The message points are checked after a clean
// relaunch of the app. The action points are checked after main's restart, because the MCP
// sign-in lives in main's memory under JUNO_E2E and a relaunch would forget it; a clean
// relaunch then shows the settled card from disk.
//
// Rotation ages the persisted journal while the app is closed. Backup and ownership use Settings.
import { join } from 'node:path'
import type { FakeLittlebird } from '@juno/agent-testing/mcp'
import type { OpenRouterRequest, ToolCallAnswer } from '@juno/agent-testing/openrouter'
import type { CrashPoint } from '@juno/agent/crash'
import { Juno } from '../driver/juno'
import { hooks, launchApp, type LaunchOptions, type RunningApp } from '../fixtures'
import { addServer, agentReady, card, expectArmedCrash, expectKilled, launchArmed, openChat, openSettings, ready, restartArmed } from './agent'
import { answer as echo, expect, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

const NOTE = 'save a note about the address'

/** The note request proposes a Littlebird write; "forget my first message" proposes a removal; the rest is echoed. */
function answer(request: OpenRouterRequest): string | ToolCallAnswer {
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

const MESSAGE_POINTS: ReadonlyArray<CrashPoint> = ['inbox.committed', 'bridge.reset', 'bridge.submitted']

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

/** Connects the fake Littlebird, has Juno propose a note, and clicks Apply with `point` armed. */
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
  await change.getByRole('button', { name: 'Apply' }).click()
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

test('a click made durable just before the agent dies is applied once when it comes back', async ({ userData, options, mcp }) => {
  await using(launchArmed(userData, options, 'approval.committed'), async (juno, { app }) => {
    const { pid } = await applyNote(juno, mcp, app)
    await expectKilled(app, pid)
    await agentReady(app)
    const chat = await openChat(juno)
    await expect(card(chat, 'change')).toHaveAttribute('data-card-status', 'done', { timeout: 20_000 })
    expect(mcp.materials()).toHaveLength(1)
  })
  await using(launchApp(userData, options), (juno) => expectChatIntact(juno, 'done'))
  expect(mcp.materials()).toHaveLength(1)
})

test('an authorization used up as the agent dies is never sent, and the card says Failed', async ({ userData, options, mcp }) => {
  await using(launchArmed(userData, options, 'authorization.consumed'), async (juno, { app }) => {
    const { pid } = await applyNote(juno, mcp, app)
    await expectKilled(app, pid)
    await agentReady(app)
    const chat = await openChat(juno)
    const change = card(chat, 'change')
    await expect(change).toHaveAttribute('data-card-status', 'failed', { timeout: 20_000 })
    await expect(change.getByText('Failed', { exact: true })).toBeVisible()
    await expect(change.getByRole('button')).toHaveCount(0)
    expect(mcp.calls.map((call) => call.name)).not.toContain('add_material')
  })
  await using(launchApp(userData, options), (juno) => expectChatIntact(juno, 'failed'))
  expect(mcp.materials()).toHaveLength(0)
})

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

/** Juno proposes removing the first message; the owner clicks Remove with `point` armed. */
async function removeFirst(juno: Juno, app: RunningApp['app']): Promise<{ readonly pid: number | undefined }> {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send('the offsite is on Friday')
  await chat.expectJuno('You said: the offsite is on Friday')
  await chat.send('forget my first message')
  await chat.expectJuno('Ready to remove it.')
  const remove = card(chat, 'remove')
  await expect(remove).toHaveAttribute('data-card-status', 'open')
  const pid = await hooks(app, 'agentPid')
  await remove.getByRole('button', { name: 'Remove', exact: true }).click()
  return { pid }
}

test('a removal cut off after its deletion record leaves the message, and removing again works once', async ({ userData, options }) => {
  await using(launchArmed(userData, options, 'redaction.deletionRaised'), async (juno, { app }) => {
    const { pid } = await removeFirst(juno, app)
    await expectKilled(app, pid)
  })
  await using(launchApp(userData, options), async (juno) => {
    await juno.waitForSync()
    await agentReady(juno.app)
    const chat = await openChat(juno)
    await expect(chat.ownerBubble('forget my first message')).toHaveCount(1)
    await expect(chat.ownerBubble('the offsite is on Friday')).toHaveCount(1)
    await expect(chat.root.getByText('Removed', { exact: true })).toHaveCount(0)
    await chat.send('forget my first message again')
    await chat.expectJuno('Ready to remove it.')
    const again = card(chat, 'remove').last()
    await again.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(chat.ownerBubble('the offsite is on Friday')).toHaveCount(0)
    await expect(again).toHaveAttribute('data-card-status', 'done')
  })
})

for (const point of ['redaction.committed', 'redaction.purged'] as const) {
  test(`a removal committed before the agent dies at ${point} stays removed after a relaunch`, async ({ userData, options }) => {
    await using(launchArmed(userData, options, point), async (juno, { app }) => {
      const { pid } = await removeFirst(juno, app)
      await expectKilled(app, pid)
    })
    await using(launchApp(userData, options), async (juno) => {
      await juno.waitForSync()
      await agentReady(juno.app)
      const chat = await openChat(juno)
      await expect(chat.ownerBubble('the offsite is on Friday')).toHaveCount(0)
      await expect(chat.ownerBubble('forget my first message')).toHaveCount(1)
      await expect(card(chat, 'remove')).toHaveAttribute('data-card-status', 'done')
    })
  })
}


for (const point of ['rotation.drained', 'rotation.committed'] as const) {
  test(`rotation at ${point} keeps the chat and an unapproved card`, async ({ userData, options, mcp }) => {
    await using(launchApp(userData, options), async (juno) => {
      await ready(juno)
      const { id } = await addServer(juno, 'Notes', mcp.url)
      const chat = await openChat(juno)
      await chat.send(`${NOTE} on ${id}`)
      await chat.expectJuno('The note is ready for you to review.')
      await card(chat, 'change').getByRole('button', { name: 'Apply' }).click()
      await expect(card(chat, 'change')).toHaveAttribute('data-card-status', 'done')
      await chat.send(`${NOTE} on ${id} again`)
      await expect(card(chat, 'change')).toHaveCount(2)
      await expect(card(chat, 'change').last()).toHaveAttribute('data-card-status', 'open')
      await expect(chat.junoBubble('The note is ready for you to review.')).toHaveCount(2)
      await settled(chat)
    })
    await using(launchApp(userData, options), async (juno, { app }) => {
      await juno.waitForSync()
      await agentReady(app)
      await restartArmed(app, point, join(userData, 'agent', 'agent.sqlite'))
      await juno.waitForSync()
      await expectArmedCrash(app)
      const chat = await openChat(juno)
      await expect(chat.ownerBubble(NOTE)).toHaveCount(2)
      await expect(chat.junoBubble('The note is ready for you to review.')).toHaveCount(2)
      await expect(card(chat, 'change').last()).toHaveAttribute('data-card-status', 'open')
      await chat.send('are you still here?')
      await chat.expectJuno('You said: are you still here?')
      expect(mcp.materials()).toHaveLength(1)
    })
  })
}

for (const point of ['backup.segmentWritten', 'backup.manifestRenamed', 'ownership.released'] as const) {
  test(`${point} recovers without losing the chat or approving an open card`, async ({ userData, options, mcp }) => {
    await using(launchApp(userData, { ...options, backupIntervalMs: 1_000 }), async (juno, { app }) => {
      await ready(juno)
      const { id } = await addServer(juno, 'Notes', mcp.url)
      const chat = await openChat(juno)
      await chat.send(`${NOTE} on ${id}`)
      await chat.expectJuno('The note is ready for you to review.')
      await card(chat, 'change').getByRole('button', { name: 'Apply' }).click()
      await expect(card(chat, 'change')).toHaveAttribute('data-card-status', 'done')
      await chat.send(`${NOTE} on ${id} again`)
      await expect(card(chat, 'change')).toHaveCount(2)
      await expect(card(chat, 'change').last()).toHaveAttribute('data-card-status', 'open')
      await expect(chat.junoBubble('The note is ready for you to review.')).toHaveCount(2)
      await settled(chat)
      await restartArmed(app, point)
      if (point === 'ownership.released') {
        await agentReady(app)
        const settings = await openSettings(juno, 'Backup & This Mac')
        await settings.getByRole('button', { name: 'Move', exact: true }).click()
        await juno.win.getByRole('dialog', { name: 'Move to another Mac' }).getByRole('button', { name: 'Move', exact: true }).click()
      }
      await expectArmedCrash(app)
      // The interrupted Move sheet can be dismissed after the agent comes back.
      await juno.win.keyboard.press('Escape')
      await openChat(juno)
      await expect(chat.ownerBubble(NOTE)).toHaveCount(2)
      await expect(chat.junoBubble('The note is ready for you to review.')).toHaveCount(2)
      await expect(card(chat, 'change').last()).toHaveAttribute('data-card-status', 'open')
      if (point === 'ownership.released') {
        await expect(chat.composer).toBeDisabled()
        await expect(chat.root.locator('[data-banner="otherDevice"]')).toBeVisible()
        const settings = await openSettings(juno, 'Backup & This Mac')
        await expect(settings.locator('[data-owner-line]')).toHaveText(/^Move code /, { timeout: 30_000 })
      } else {
        await chat.send('are you still here?')
        await chat.expectJuno('You said: are you still here?')
        const settings = await openSettings(juno, 'Backup & This Mac')
        await expect(settings.locator('[data-last-backup]')).toContainText('Last backup', { timeout: 30_000 })
      }
      expect(mcp.materials()).toHaveLength(1)
      expect(mcp.calls.filter((call) => call.name === 'add_material')).toHaveLength(1)
    })
  })
}
