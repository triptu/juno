import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, test } from './fixtures'

test.use({ fakeAiDelayMillis: 2_000 })
test.describe.configure({ timeout: 120_000 })

for (const destination of ['self-DM', 'channel'] as const) {
  test(`late spelling fixes in a ${destination} can be reviewed, saved and dismissed`, async ({ juno, fake, userData }) => {
    const channel = destination === 'self-DM' ? fake.workspace.open([fake.selfId]).conversation.id : 'C0ENG'
    if (destination === 'self-DM') fake.injectMessage({ channel, user: fake.selfId, text: 'Notes for today' })
    await juno.signIn()
    await juno.waitForSync()
    await juno.sidebar.row(destination === 'self-DM' ? 'Tushar' : '#eng').open()
    const original = 'does grammer chek properly happen?'
    const fixed = 'does grammar check properly happen?'
    const suggestion = juno.win.locator('[data-send-suggestion]')
    await juno.topic.send(original)
    await juno.topic.expectSent(original)
    await expect.poll(() => fake.messages(channel).some((message) => message.text === original)).toBe(true)
    await expect(suggestion).toContainText('grammer → grammar')
    await expect(suggestion).toContainText('chek → check')
    await expect(suggestion).toContainText('2 small fixes')
    const row = juno.topic.list.locator('[data-message-row]').filter({ hasText: original })
    await expect(row.locator('[data-send-suggestion]')).toBeVisible()
    await juno.win.screenshot({ path: test.info().outputPath(`grammar-${destination}.png`) })
    await suggestion.getByRole('button', { name: 'Review', exact: true }).click()
    const editor = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(editor).toHaveValue(fixed)
    expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)
    await juno.topic.list.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => fake.messages(channel).some((message) => message.text === fixed)).toBe(true)
    expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(1)
    await expect(suggestion).toHaveCount(0)

    await juno.topic.send('please chek the the report')
    await juno.topic.expectSent('please chek the the report')
    await expect(suggestion).toContainText('the the → the')
    await expect(suggestion).toContainText('chek → check')
    await suggestion.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(suggestion).toHaveCount(0)
    await juno.sidebar.row('Rina finished the onsite').open()
    await juno.sidebar.row(destination === 'self-DM' ? 'Tushar' : '#eng').open()
    await expect(suggestion).toHaveCount(0)
    expect(fake.messages(channel).some((message) => message.text === 'please chek the the report')).toBe(true)
    expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(1)

    await juno.topic.send('the report is ready')
    await juno.topic.expectSent('the report is ready')
    await expect.poll(() => {
      const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'), { readOnly: true })
      try { return db.prepare("SELECT summary FROM ai_calls WHERE feature = 'grammarCheck' ORDER BY id DESC LIMIT 1").get()?.['summary'] }
      finally { db.close() }
    }, { timeout: 10_000 }).toBe('No fixes')
    await expect(suggestion).toHaveCount(0)
  })
}
