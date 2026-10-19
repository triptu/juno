import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

async function setup(juno: Juno, fake: FakeSlack) {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Reaction delivery target' })
  const row = juno.topic.message('Reaction delivery target')
  await expect(row).toBeVisible()
  const react = async () => {
    await row.hover()
    await row.getByRole('button', { name: 'React 👀' }).click()
  }
  const sent = () => fake.messages('C0ENG').find((m) => m.ts === message.ts)?.reactions?.some((r) => r.name === 'eyes') === true
  return { row, react, sent, ts: message.ts }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// This checks that a reaction beats the edit's real exponential retry backoff.
const productionTiming = test.extend({ timing: 'production' })

productionTiming('reaction behind a retrying edit', async ({ juno, fake }) => {
  const target = await setup(juno, fake)
  await juno.topic.send('Edit before reacting')
  await juno.topic.expectSent('Edit before reacting')
  fake.forceError({ method: 'chat.update', error: 'internal_error', times: 5 })
  await juno.topic.composer.press('ArrowUp')
  await juno.topic.message('Edit before reacting').press('e')
  const field = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await field.fill('Edited before reacting')
  await field.press('Enter')
  await expect.poll(() => fake.calls.filter((c) => c.method === 'chat.update').length).toBe(1)
  const start = Date.now()
  await target.react()
  await expect.poll(target.sent, { timeout: 3000 }).toBe(true)
  expect(fake.calls.filter((c) => c.method === 'chat.update').length).toBeLessThan(5)
  console.log(`reaction behind edit: ${Date.now() - start} ms; edit calls ${fake.calls.filter((c) => c.method === 'chat.update').length}`)
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
})

test('reaction offline then online', async ({ juno, fake }) => {
  const target = await setup(juno, fake)
  fake.goOffline()
  await juno.sidebar.expectSyncStatus("You're offline")
  await target.react()
  await expect(target.row.getByRole('button', { name: '1 👀, including you' })).toBeVisible()
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
  await expect(target.row.locator('[data-reaction-issue="waiting"]')).toBeVisible({ timeout: 5000 })
  console.log(`offline pending: ${await target.row.locator('[data-reaction-issue]').allTextContents()}`)
  const start = Date.now()
  fake.goOnline()
  await expect.poll(target.sent, { timeout: 40_000 }).toBe(true)
  console.log(`reaction after reconnect enabled: ${Date.now() - start} ms`)
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
})

test('reaction retries a transient failure', async ({ juno, fake }) => {
  const target = await setup(juno, fake)
  fake.forceError({ method: 'reactions.add', error: 'internal_error', times: 1 })
  const start = Date.now()
  await target.react()
  await expect.poll(target.sent).toBe(true)
  console.log(`transient reaction: ${Date.now() - start} ms`)
  expect(fake.calls.filter((c) => c.method === 'reactions.add')).toHaveLength(2)
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
})

test('reaction added then removed before it can send makes no Slack calls', async ({ juno, fake }) => {
  const target = await setup(juno, fake)
  fake.goOffline()
  await juno.sidebar.expectSyncStatus("You're offline")
  const start = Date.now()
  await target.react()
  await target.row.getByRole('button', { name: '1 👀, including you' }).click()
  await expect(target.row.getByRole('button', { name: '1 👀, including you' })).toHaveCount(0)
  console.log(`reaction canceled locally: ${Date.now() - start} ms`)
  fake.goOnline()
  await expect.poll(() => fake.socketCount(), { timeout: 40_000 }).toBeGreaterThan(0)
  await pause(1500)
  expect(fake.calls.filter((c) => c.method.startsWith('reactions.'))).toHaveLength(0)
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
})

test('reaction to a message deleted in Slack fails', async ({ juno, fake }) => {
  const target = await setup(juno, fake)
  fake.holdFrames({ types: ['message'] })
  fake.deleteMessage({ channel: 'C0ENG', ts: target.ts })
  const start = Date.now()
  await target.react()
  await expect(target.row.locator('[data-reaction-issue="failed"]')).toBeVisible()
  console.log(`deleted message reaction: ${Date.now() - start} ms; ${await target.row.locator('[data-reaction-issue]').textContent()}`)
  await expect(target.row.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
  expect(target.sent()).toBe(false)
  await juno.expectToast('Reaction not sent')
  await expect(target.row.locator('[data-reaction-issue]')).toContainText('Reaction not sent')
  await target.row.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
  expect(fake.calls.filter((c) => c.method === 'reactions.remove')).toHaveLength(0)
})


test('reaction stops after five failures, toasts once, and Retry starts a new attempt', async ({ juno, fake }) => {
  const target = await setup(juno, fake)
  fake.forceError({ method: 'reactions.add', error: 'internal_error', times: 5 })
  await target.react()
  await expect(target.row.locator('[data-reaction-issue="waiting"]')).toBeVisible({ timeout: 6000 })
  await expect(target.row.locator('[data-reaction-issue="failed"]')).toBeVisible({ timeout: 20_000 })
  await juno.expectToast('Reaction not sent')
  expect(fake.calls.filter((c) => c.method === 'reactions.add')).toHaveLength(5)
  await expect(target.row.getByRole('button', { name: '1 👀, including you' })).toHaveCount(0)
  await expect(juno.toast('Reaction not sent')).toHaveCount(0, { timeout: 6000 })
  await juno.sidebar.row('#product').open()
  await juno.sidebar.row('#eng').open()
  await expect(target.row.locator('[data-reaction-issue="failed"]')).toBeVisible()
  await expect(juno.toast('Reaction not sent')).toHaveCount(0)
  await target.row.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(target.sent).toBe(true)
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
  expect(fake.calls.filter((c) => c.method === 'reactions.add')).toHaveLength(6)
})
