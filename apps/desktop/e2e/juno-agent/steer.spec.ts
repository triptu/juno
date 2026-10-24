// Steering Juno while it works (plan v3 §16 flow 2, SPEC 13.2 and 13.5): a message sent during
// a run joins it at its next step, Juno answers it, and "stop" is a message like any other.
import { openPage, readySynced as ready, openChat } from './agent'
import { answer, expect, test as base } from './chat'
import { startScriptedModel, type ScriptedModel } from './model'

const test = base.extend<{ readonly model: ScriptedModel }>({
  // oxlint-disable-next-line no-empty-pattern
  model: async ({}, use) => {
    const model = await startScriptedModel({ answer })
    await use(model)
    await model.close()
  },
})

test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

test('"stop" sent while Juno is busy joins the same run and is answered as a message, with no Stop anywhere', async ({ juno, model }) => {
  await ready(juno)
  const chat = await openChat(juno)
  const gate = model.hold('what is on today?')

  await chat.send('what is on today?')
  await expect.poll(() => gate.arrived()).toBe(true)
  await expect(chat.root.locator('[data-chat-status]')).toBeVisible()
  await expect(chat.root.getByRole('button', { name: 'Stop' })).toHaveCount(0)

  await chat.send('stop')
  // The bubble shows nothing extra while it waits for the next step.
  await chat.expectOwner('stop')
  await expect(chat.ownerBubble('stop').locator('[data-delivery]')).toHaveCount(0)
  gate.release()

  await chat.expectJuno('You said: what is on today?')
  await chat.expectJuno('You said: stop')
  await expect(chat.root.locator('[data-chat-status]')).toHaveCount(0)
  await expect(chat.root.locator('[data-chat-ending]')).toHaveCount(0)
  await expect(chat.root.getByRole('button', { name: 'Stop' })).toHaveCount(0)
  // "stop" reached the model as the owner's words, after the first answer.
  expect(model.inputs()).toEqual(['<message id="n1">what is on today?</message>', expect.stringMatching(/^<message id="n\d+">stop<\/message>$/)])

  // One run, the owner's, answered both.
  const activity = await openPage(juno, 'Activity')
  const runs = activity.locator('[data-activity-run]')
  await expect(runs).toHaveCount(1)
  await expect(runs).toHaveAttribute('data-activity-run', 'replied')
  await expect(runs.locator('[data-activity-trigger="message"]')).toHaveText('what is on today?')
})
