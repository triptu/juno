import { expect, test } from './fixtures'

test('a bot attachment names its thread and expands its description', async ({ juno, fake }) => {
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0DEPLOYBOT', text: '[sample/project] Pull request opened', attachments: [{
    title: '#42 Improve cache', title_link: 'https://example.test/pull/42', color: 'good',
    text: 'Cache details.\n'.repeat(90) + 'Final verification detail.',
    fields: [{ title: 'Status', value: 'Ready', short: true }],
  }], silent: true })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0DEPLOYBOT', text: '', attachments: [{ text: 'Attachment preview detail' }], threadTs: root.ts, silent: true })
  fake.followThread({ channel: 'C0ENG', threadTs: root.ts })
  await juno.signIn()
  await juno.waitForSync()
  const row = juno.sidebar.row('PR #42: Improve cache')
  await expect(row.preview).toContainText('Attachment preview detail')
  await juno.accountMenu.open()
  await juno.accountMenu.item(/^Hide message text/).click()
  await juno.privacy.expectBlurred(row.preview)
  await juno.privacy.expectBlurred(row.titleText, false)
  await row.open()
  await juno.topic.expectTitle('PR #42: Improve cache')
  const card = juno.win.getByRole('region', { name: 'Attachment' }).filter({ has: juno.win.getByRole('link', { name: '#42 Improve cache' }) })
  await expect(card.getByRole('link', { name: '#42 Improve cache' })).toHaveAttribute('href', 'https://example.test/pull/42')
  const before = await card.boundingBox()
  await card.getByRole('button', { name: 'Show more' }).click()
  await expect(card.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  await expect(card.getByText('Ready', { exact: true })).toBeVisible()
  expect((await card.boundingBox())!.height).toBeGreaterThan(before!.height)
  expect(fake.calls.filter((call) => /interactive|actions/.test(call.method))).toHaveLength(0)
})
