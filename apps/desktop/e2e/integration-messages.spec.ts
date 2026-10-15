import { expect, test } from './fixtures'

test('a bot attachment names its thread and expands its description', async ({ juno, fake }) => {
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0DEPLOYBOT', text: '[sample/project] Pull request opened', attachments: [{
    title: '#42 Improve cache', title_link: 'https://example.test/pull/42', color: 'good',
    text: 'Cache details.\n'.repeat(90) + 'Final verification detail.',
    fields: [{ title: 'Status', value: 'Ready', short: true }],
  }], silent: true })
  fake.workspace.post({ channel: 'C0ENG', user: fake.selfId, text: 'Reviewing this now.', threadTs: root.ts, silent: true })
  fake.followThread({ channel: 'C0ENG', threadTs: root.ts })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('PR #42: Improve cache').open()
  await juno.topic.expectTitle('PR #42: Improve cache')
  const card = juno.win.getByRole('region', { name: 'Attachment' })
  await expect(card.getByRole('link', { name: '#42 Improve cache' })).toHaveAttribute('href', 'https://example.test/pull/42')
  const before = await card.boundingBox()
  await card.getByRole('button', { name: 'Show more' }).click()
  await expect(card.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  expect((await card.boundingBox())!.height).toBeGreaterThan(before!.height)
  expect(fake.calls.filter((call) => /interactive|actions/.test(call.method))).toHaveLength(0)
})
