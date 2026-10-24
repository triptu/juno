// The chat's states in the app (plan v3 §16 flows 2, 12, 13 and 15, SPEC 13.2, 13.5 and 13.7):
// a run while it works and when it fails, steering it, and every other state a user can reach
// against the fakes. Pause and the model picker are on the pages walk (pages.spec.ts). The gallery
// shows each state from fixtures (`packages/views/src/juno-chat/*.fixtures.tsx`).
import { readdirSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { chatCopy } from '@juno/agent-contract'
import { agentReady, openChat, openPage, readySynced as ready } from './agent'
import { answer, expect, JunoChatPane, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

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

test.describe.configure({ timeout: 180_000 })

// One launch walks the states that need no relaunch. The run that fails comes first, so Activity counts
// only its runs, and the message too large for its request comes last, so no later run carries it.
test('the chat while Juno works, when a run fails, when storage fails, offline, and for messages over the limit', async ({ juno, fake, model, userData }) => {
  await ready(juno)
  const chat = await openChat(juno)
  await expect(chat.root.getByText(chatCopy.empty.title)).toBeVisible()

  await test.step('"stop" sent while Juno works joins the same run, and a run the model fails says so with Try again', async () => {
    // A message sent during a run joins it at its next step, and "stop" is a message like any other: no Stop anywhere.
    const busy = model.hold('what is on today?')
    await chat.send('what is on today?')
    await expect.poll(() => busy.arrived()).toBe(true)
    await expect(chat.root.getByRole('status')).toHaveAttribute('aria-label', 'Juno is working')
    await expect(chat.root.getByRole('button', { name: 'Stop' })).toHaveCount(0)
    await chat.send('stop')
    await chat.expectOwner('stop')
    await expect(chat.ownerBubble('stop').locator('[data-delivery]')).toHaveCount(0)
    busy.release()
    await chat.expectJuno('You said: what is on today?')
    await chat.expectJuno('You said: stop')
    await expect(chat.root.locator('[data-chat-status]')).toHaveCount(0)
    await expect(chat.root.locator('[data-chat-ending]')).toHaveCount(0)
    expect(model.inputs()).toEqual(['<message id="n1">what is on today?</message>', expect.stringMatching(/^<message id="n\d+">stop<\/message>$/)])

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

    // One run answered the message and "stop"; the failed run and its retry are two more.
    const activity = await openPage(juno, 'Activity')
    await expect(activity.locator('[data-activity-run="failed"]')).toHaveCount(1)
    await expect(activity.locator('[data-activity-run="replied"]')).toHaveCount(2)
    await expect(activity.locator('[data-activity-trigger="message"]').filter({ hasText: /^stop$/ })).toHaveCount(0)
  })

  await test.step('a storage failure keeps the message as Not delivered, and Try again stores it once', async () => {
    await openChat(juno)
    const before = model.inputs().length
    const db = new DatabaseSync(join(userData, 'agent', 'agent.sqlite'))
    try {
      db.exec("PRAGMA busy_timeout = 10000")
      // Fail only this inbox write; the real RPC must report the failed commit to the UI.
      db.exec("CREATE TRIGGER fail_test_send BEFORE INSERT ON inbox WHEN NEW.text = 'keep my unsent message' BEGIN SELECT RAISE(FAIL, 'test storage failure'); END")
      await chat.send('keep my unsent message')
      const owner = chat.ownerBubble('keep my unsent message')
      await expect(owner.locator('[data-delivery="failed"]')).toContainText(chatCopy.delivery.notDelivered)
      expect(model.inputs()).toHaveLength(before)
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

  await test.step('offline, the chat shows the chip, a message waits for the network, and both clear once back with one model request', async () => {
    const before = model.inputs().length
    fake.goOffline()
    const chip = chat.root.locator('[data-banner="offline"]')
    await expect(chip).toHaveText(chatCopy.banner.offline.chip, { timeout: 30_000 })
    await expect(chat.composer).toBeEnabled()
    await chat.send('what did I miss?')
    await expect(chat.ownerBubble('what did I miss?').locator('[data-delivery="waiting"]')).toHaveText(chatCopy.delivery.waiting.network)
    await expect(chat.junoBubble('You said: what did I miss?')).toHaveCount(0)
    expect(model.inputs()).toHaveLength(before)

    fake.goOnline()
    await expect(chip).toHaveCount(0, { timeout: 30_000 })
    await chat.expectJuno('You said: what did I miss?')
    expect(model.inputs()).toHaveLength(before + 1)
  })

  await test.step('a message over the size limit is marked too long, one at the limit is kept when request framing makes it too large, and neither reaches the model', async () => {
    const before = model.inputs().length
    // Earlier steps left failed messages and endings of their own: count from here, and read the newest.
    const failed = chat.root.locator('[data-delivery="failed"]')
    const failedBefore = await failed.count()
    const long = 'word '.repeat(14_000).trim()
    await chat.send(long)
    await expect(chat.root.locator('[data-chat-owner] [data-delivery="failed"]').last()).toHaveText(chatCopy.delivery.tooLong)

    // The composer accepts 65,536 bytes, but the active request must also fit its framing.
    const text = 'x'.repeat(65_536)
    await chat.send(text)
    await expect(chat.root.locator('[data-chat-ending]').last()).toHaveText(chatCopy.ending.blocked.tooLarge, { timeout: 15_000 })
    await expect(chat.ownerBubble(text)).toHaveCount(1)
    await expect(failed).toHaveCount(failedBefore + 1)
    expect(model.inputs()).toHaveLength(before)
  })
})

// Two relaunches in one test: an interrupted reply first, then records from a newer build, which leave the chat disabled.
test('an interrupted reply keeps the owner message and Try again answers it once, and records newer than this build show Update needed', async ({ juno, model, relaunch, userData }) => {
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
  await test.step('an interrupted reply keeps the owner message and Try again answers it once', async () => {
    const pane = await openChat(again)
    await expect(pane.ownerBubble('keep these words')).toHaveCount(1)
    const ending = pane.root.locator('[data-chat-ending]')
    await expect(ending).toContainText('Juno was interrupted. Your message is kept.')
    await ending.getByRole('button', { name: 'Try again' }).click()
    await pane.expectJuno('You said: keep these words')
    await expect(pane.junoBubble('You said: keep these words')).toHaveCount(1)
  })

  const later = await relaunch({ whileClosed: async () => {
    const dir = join(userData, 'agent')
    const journal = readdirSync(dir).find((name) => /^pi-.+\.sqlite$/.test(name))!
    const db = new DatabaseSync(join(dir, journal))
    try { db.prepare('UPDATE durable_schema SET version = version + 1000 WHERE singleton = 1').run() } finally { db.close() }
  } })
  await later.waitForSync()
  await test.step('records newer than this build show Update needed and disable the composer', async () => {
    const chip = (await openChat(later)).root.locator('[data-banner="updateNeeded"]')
    await expect(chip).toHaveText(chatCopy.banner.updateNeeded.chip, { timeout: 30_000 })
    await expect(JunoChatPane.tab(later.win).composer).toBeDisabled()
  })
})
