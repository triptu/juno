// A reaction on its way to Slack (spec section 7, "Reactions"): one that
// keeps failing stops after five tries with one toast, stays marked on the
// message, and Retry starts again. How the outbox spaces and drops tries is
// the engine's (outbox-reactions.flow.test.ts); workspace emoji in the picker,
// whose cells are drawn as its list scrolls, are reaction-delivery.spec.ts's.
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { MessageMenuDriver } from './driver/topic'
import { expect } from './expect'
import { domTest } from './test'

async function setup(juno: Juno, fake: FakeSlack) {
  await juno.sidebar.row('#eng').open()
  const message = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'Reaction delivery target' })
  const row = juno.topic.message('Reaction delivery target')
  await expect(row).toBeVisible()
  const menu = () => new MessageMenuDriver(juno.win).openOnRow(row)
  const sent = () => fake.messages('C0ENG').find((m) => m.ts === message.ts)?.reactions?.some((r) => r.name === 'eyes') === true
  return { row, menu, sent, ts: message.ts }
}

domTest('reaction stops after five failures, toasts once, and Retry starts a new attempt', async ({ juno, fake }) => {
  const target = await setup(juno, fake)
  fake.forceError({ method: 'reactions.add', error: 'internal_error', times: 5 })
  await (await target.menu()).react('eyes')
  await expect(target.row.locator('[data-reaction-issue="waiting"]')).toBeVisible({ timeout: 6000 })
  await expect(target.row.locator('[data-reaction-issue="failed"]')).toBeVisible({ timeout: 20_000 })
  await juno.expectToast('Reaction not sent')
  expect(fake.calls.filter((c) => c.method === 'reactions.add')).toHaveLength(5)
  await expect(target.row.getByRole('button', { name: '1 👀, including you' })).toHaveCount(0)
  await expect(juno.toast('Reaction not sent')).toHaveCount(0, { timeout: 6000 })
  await juno.sidebar.row('#product').open()
  await juno.sidebar.row('#eng').open()
  await expect(target.row.locator('[data-reaction-issue="failed"]')).toBeVisible()
  // The toast would come with the row's first frame; give it a moment to show.
  await new Promise((done) => setTimeout(done, 500))
  await expect(juno.toast('Reaction not sent')).toHaveCount(0)
  await target.row.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.poll(target.sent).toBe(true)
  await expect(target.row.locator('[data-reaction-issue]')).toHaveCount(0)
  expect(fake.calls.filter((c) => c.method === 'reactions.add')).toHaveLength(6)
})
