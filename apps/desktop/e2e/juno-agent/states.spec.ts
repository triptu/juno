// The chat's states in the app (plan v3 §16 flows 12, 13 and 15, SPEC 13.7): the model picker,
// Pause and AI off, and every other state a user can reach against the fakes. The gallery shows
// each state from fixtures (`packages/views/src/juno-chat/*.fixtures.tsx`).
import { readdirSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { chatCopy } from '@juno/agent-contract'
import { agentReady, openChat, openPage, openSettings, readySynced as ready } from './agent'
import { answer, expect, JunoChatPane, test as base } from './chat'
import { startScriptedModel, type CatalogueModel, type ScriptedModel } from './model'

/** The echo model, except that the first message saying "fail once" gets a server error. */
const test = base.extend<{ readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    let failed = false
    const model = await startScriptedModel({
      answer: (request) => {
        if (!failed && request.input.includes('fail once')) {
          failed = true
          throw new Error('the model is down')
        }
        return answer(request)
      },
    })
    await use(model)
    await model.close()
  },
})

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const NEWER = 1_800_000_000

/** Newer models in four families: one fit to use, and three the picker must hide. */
function withNewer(models: ReadonlyArray<CatalogueModel>): ReadonlyArray<CatalogueModel> {
  const like = (id: string) => models.find((model) => model.id === id)!
  return [
    ...models,
    { ...like('anthropic/claude-sonnet-5.5'), id: 'anthropic/claude-sonnet-6', name: 'Anthropic: Claude Sonnet 6', created: NEWER },
    { ...like('anthropic/claude-opus-5.5'), id: 'anthropic/claude-opus-6:batch', name: 'Anthropic: Claude Opus 6 (batch)', created: NEWER },
    { ...like('x-ai/grok-4.7'), id: 'x-ai/grok-5', name: 'xAI: Grok 5', created: NEWER, supported_parameters: ['max_tokens'] },
    { ...like('meta/muse-wonder'), id: 'meta/muse-zenith', name: 'Meta: Muse Zenith', created: NEWER, context_length: 4_096 },
  ]
}

const picker = base.extend<{ readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startScriptedModel({ answer, catalogue: withNewer })
    await use(model)
    await model.close()
  },
})

picker('the chat model picker offers the newest usable model per family and hides batch, no-tools and small-window models', async ({ juno }) => {
  await ready(juno)
  const page = await openSettings(juno, 'Juno')
  const names = () =>
    page
      .getByLabel('Chat model')
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.textContent!.split(' · ')[0]))
  await expect.poll(names, { timeout: 15_000 }).toEqual(['Claude Sonnet 6', 'Claude Opus 5.5', 'Muse Wonder', 'GPT-6.1 Sol', 'Grok 4.7'])
  await expect(page.getByLabel('Chat model').locator('option').filter({ hasText: /Codex/ })).toHaveCount(0)
})

test('while Juno is paused a message waits for Resume, then runs', async ({ juno, model }) => {
  await ready(juno)
  const settings = await openSettings(juno, 'Juno')
  await settings.getByLabel('Pause Juno').check()
  const chat = await openChat(juno)
  await expect(chat.root.locator('[data-banner="paused"]')).toHaveText(`${chatCopy.banner.paused.chip} · ${chatCopy.banner.paused.resume}`)

  await chat.send('anything new?')
  await expect(chat.ownerBubble('anything new?').locator('[data-delivery="waiting"]')).toHaveText(chatCopy.delivery.waiting.resume)
  expect(model.inputs()).toEqual([])

  await chat.root.locator('[data-banner="paused"]').getByRole('button', { name: 'Resume' }).click()
  await chat.expectJuno('You said: anything new?')
  await expect(chat.ownerBubble('anything new?').locator('[data-delivery]')).toHaveCount(0)
})

test('an empty chat asks what you need, a run shows the status bubble, and a run the model fails says so with Try again', async ({ juno, model }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await expect(chat.root.getByText(chatCopy.empty.title)).toBeVisible()

  const gate = model.hold('fail once')
  await chat.send('fail once')
  await expect.poll(() => gate.arrived()).toBe(true)
  await expect(chat.root.getByRole('status')).toHaveAttribute('aria-label', 'Juno is working')
  gate.release()

  const ending = chat.root.locator('[data-chat-ending]')
  await expect(ending).toHaveText(`${chatCopy.ending.failed.provider} ${chatCopy.ending.tryAgain}`, { timeout: 15_000 })
  await expect(chat.root.locator('[data-chat-status]')).toHaveCount(0)
  await ending.getByRole('button', { name: chatCopy.ending.tryAgain }).click()
  await chat.expectJuno('You said: fail once')

  const activity = await openPage(juno, 'Activity')
  await expect(activity.locator('[data-activity-run="failed"]')).toHaveCount(1)
  await expect(activity.locator('[data-activity-run="replied"]')).toHaveCount(1)
})

test('a message over the size limit stays in the chat, marked too long, and never reaches the model', async ({ juno, model }) => {
  await ready(juno)
  const chat = await openChat(juno)
  const long = 'word '.repeat(14_000).trim()
  await chat.send(long)
  await expect(chat.root.locator('[data-chat-owner] [data-delivery="failed"]')).toHaveText(chatCopy.delivery.tooLong)
  expect(model.inputs()).toEqual([])
})

test('a storage failure keeps the message as Not delivered, and Try again stores it once', async ({ juno, model, userData }) => {
  await ready(juno)
  const chat = await openChat(juno)
  const db = new DatabaseSync(join(userData, 'agent', 'agent.sqlite'))
  try {
    db.exec("PRAGMA busy_timeout = 10000")
    // Fail only this inbox write; the real RPC must report the failed commit to the UI.
    db.exec("CREATE TRIGGER fail_test_send BEFORE INSERT ON inbox WHEN NEW.text = 'keep my unsent message' BEGIN SELECT RAISE(FAIL, 'test storage failure'); END")
    await chat.send('keep my unsent message')
    const owner = chat.ownerBubble('keep my unsent message')
    await expect(owner.locator('[data-delivery="failed"]')).toContainText(chatCopy.delivery.notDelivered)
    expect(model.inputs()).toEqual([])
    expect(db.prepare("SELECT count(*) AS count FROM inbox WHERE text = 'keep my unsent message'").get()?.count).toBe(0)

    db.exec('DROP TRIGGER fail_test_send')
    await owner.getByRole('button', { name: 'Try again' }).click()
    await chat.expectJuno('You said: keep my unsent message')
    await expect(owner).toHaveCount(1)
    await expect(owner.locator('[data-delivery]')).toHaveCount(0)
    expect(db.prepare("SELECT count(*) AS count FROM inbox WHERE text = 'keep my unsent message'").get()?.count).toBe(1)
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_test_send')
    db.close()
  }
})

test('a message at the send limit is kept when request framing makes it too large', async ({ juno, model }) => {
  await ready(juno)
  const chat = await openChat(juno)
  // The composer accepts 65,536 bytes, but the active request must also fit its framing.
  const text = 'x'.repeat(65_536)
  await chat.send(text)
  await expect(chat.root.locator('[data-chat-ending]')).toHaveText(chatCopy.ending.blocked.tooLarge, { timeout: 15_000 })
  await expect(chat.ownerBubble(text)).toHaveCount(1)
  await expect(chat.root.locator('[data-delivery="failed"]')).toHaveCount(0)
  expect(model.inputs()).toEqual([])
})

test('offline, the chat shows the chip, a message waits for the network, and both clear once back', async ({ juno, fake }) => {
  const chipShows = 'offline, the chat shows the chip and its composer still works, and the chip goes once back'
  const messageWaits = 'offline, a message waits for the network and runs once back'
  await ready(juno)
  const chat = await openChat(juno)
  fake.goOffline()
  const chip = chat.root.locator('[data-banner="offline"]')
  await test.step(chipShows, async () => {
    await expect(chip).toHaveText(chatCopy.banner.offline.chip, { timeout: 30_000 })
    await expect(chat.composer).toBeEnabled()
  })
  await test.step(messageWaits, async () => {
    await expect(chip).toBeVisible({ timeout: 30_000 })
    await chat.send('what did I miss?')
    await expect(chat.ownerBubble('what did I miss?').locator('[data-delivery="waiting"]')).toHaveText(chatCopy.delivery.waiting.network)
    await expect(chat.junoBubble('You said: what did I miss?')).toHaveCount(0)
  })

  fake.goOnline()
  await test.step(chipShows, async () => {
    await expect(chip).toHaveCount(0, { timeout: 30_000 })
  })
  await test.step(messageWaits, async () => {
    await chat.expectJuno('You said: what did I miss?')
  })
})

test('records newer than this build show Update needed and disable the composer', async ({ juno, relaunch, userData }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await chat.send('hello')
  await chat.expectJuno('You said: hello')
  const later = await relaunch({ whileClosed: async () => {
    const dir = join(userData, 'agent')
    const journal = readdirSync(dir).find((name) => /^pi-.+\.sqlite$/.test(name))!
    const db = new DatabaseSync(join(dir, journal))
    try { db.prepare('UPDATE durable_schema SET version = version + 1000 WHERE singleton = 1').run() } finally { db.close() }
  } })
  await later.waitForSync()
    const chip = (await openChat(later)).root.locator('[data-banner="updateNeeded"]')
    await expect(chip).toHaveText(chatCopy.banner.updateNeeded.chip, { timeout: 30_000 })
    await expect(JunoChatPane.tab(later.win).composer).toBeDisabled()
})


test('an interrupted reply keeps the owner message and Try again answers it once', async ({ juno, model, relaunch, userData }) => {
  await ready(juno)
  const chat = await openChat(juno)
  const gate = model.hold('keep these words')
  await chat.send('keep these words')
  await expect.poll(gate.arrived).toBe(true)
  const again = await relaunch({ whileClosed: async () => {
    gate.release()
    const dir = join(userData, 'agent')
    for (const name of readdirSync(dir)) {
      if (/^pi-.+\.sqlite(?:-wal|-shm)?$/.test(name)) rmSync(join(dir, name))
    }
  } })
  await again.waitForSync()
  await agentReady(again.surface)
    const pane = await openChat(again)
    await expect(pane.ownerBubble('keep these words')).toHaveCount(1)
    const ending = pane.root.locator('[data-chat-ending]')
    await expect(ending).toContainText('Juno was interrupted. Your message is kept.')
    await ending.getByRole('button', { name: 'Try again' }).click()
    await pane.expectJuno('You said: keep these words')
    await expect(pane.junoBubble('You said: keep these words')).toHaveCount(1)
})
