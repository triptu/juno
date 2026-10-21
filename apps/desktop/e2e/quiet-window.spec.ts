import { SELF_ID } from '@juno/fake-slack'
import { expect, test } from './fixtures'

const DAY = 86_400_000

test('Tidy up changes the topic window: old topics leave locally and arrive through background backfill', async ({ juno, slack }) => {
  const fake = slack.fake
  for (const [id, name, days] of [['C0QUIETFIVE', 'quiet-five', 5], ['C0QUIETTEN', 'quiet-ten', 10]] as const) {
    fake.workspace.addConversation({ id, name, kind: 'public', members: new Set([SELF_ID, 'U0LEO']), created: fake.now() - 30 * DAY, topic: '', purpose: '', isOpen: true, archived: false })
    const message = fake.workspace.post({ channel: id, user: 'U0LEO', text: `Notes from ${days} days ago`, at: fake.now() - days * DAY, silent: true })
    fake.workspace.reads.set(id, message.ts)
  }
  await juno.signIn()
  await juno.waitForSync()
  const five = juno.sidebar.row('#quiet-five').root
  const ten = juno.sidebar.row('#quiet-ten').root
  await expect(five).toHaveCount(0)
  await expect(ten).toHaveCount(0)
  await juno.openSettings('Tidy up')
  const control = juno.settings.root.getByRole('radiogroup', { name: 'Show topics active in the last' })
  await expect(control.getByRole('radio', { name: '3 days', exact: true })).toHaveAttribute('aria-checked', 'true')
  await control.getByRole('radio', { name: '7 days', exact: true }).click()
  await expect(five).toHaveCount(1, { timeout: 30_000 })
  fake.resetCalls()
  await control.getByRole('radio', { name: '3 days', exact: true }).click()
  await expect(five).toHaveCount(0)
  expect(fake.calls.filter((c) => c.args['_x_reason'] === 'window-history')).toHaveLength(0)
  const top = juno.sidebar.rows.first()
  const before = await top.boundingBox()
  await control.getByRole('radio', { name: '14 days', exact: true }).click()
  await expect(ten).toHaveCount(1, { timeout: 30_000 })
  await expect(five).toHaveCount(1)
  expect(fake.calls.some((c) => c.method === 'conversations.history' && c.args['channel'] === 'C0QUIETTEN' && c.args['_x_reason'] === 'window-history')).toBe(true)
  expect((await top.boundingBox())?.y).toBe(before?.y)
  await juno.tabs.close('Settings')
  await juno.openSettings('Tidy up')
  await expect(control.getByRole('radio', { name: '14 days', exact: true })).toHaveAttribute('aria-checked', 'true')
})
