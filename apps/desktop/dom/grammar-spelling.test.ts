// Late spelling fixes (SPEC 8, "Send checks"): the grammar model answers after the send, in a self-DM and in a
// channel; Review edits the sent message with the fixes, Save sends one update, Dismiss keeps it as sent.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect } from './expect'
import { domTest } from './test'

domTest('late spelling fixes in a self-DM and in a channel can be reviewed, saved and dismissed', async ({ juno, fake, userData, step }) => {
  const updates = () => fake.calls.filter((call) => call.method === 'chat.update').length
  for (const destination of ['self-DM', 'channel'] as const) await step(`late spelling fixes in a ${destination} can be reviewed, saved and dismissed`, async () => {
    const updatesBefore = updates()
    const channel = destination === 'self-DM' ? fake.workspace.open([fake.selfId]).conversation.id : 'C0ENG'
    if (destination === 'self-DM') fake.injectMessage({ channel, user: fake.selfId, text: 'Notes for today' })
    const title = destination === 'self-DM' ? 'Tushar' : '#eng'
    // Wait for each open before typing: the composer on screen until then is the last topic's.
    const open = async (row: string, shown: string) => {
      await juno.sidebar.row(row).open()
      await juno.topic.expectTitle(shown)
    }
    await open(title, title.replace('#', ''))
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
    await suggestion.getByRole('button', { name: 'Review', exact: true }).click()
    const editor = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
    await expect(editor).toHaveValue(fixed)
    expect(updates()).toBe(updatesBefore)
    await juno.topic.list.getByRole('button', { name: /^Save/ }).click()
    await expect.poll(() => fake.messages(channel).some((message) => message.text === fixed)).toBe(true)
    expect(updates()).toBe(updatesBefore + 1)
    await expect(suggestion).toHaveCount(0)

    await juno.topic.send('please chek the the report')
    await juno.topic.expectSent('please chek the the report')
    await expect(suggestion).toContainText('the the → the')
    await expect(suggestion).toContainText('chek → check')
    await suggestion.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await expect(suggestion).toHaveCount(0)
    await open('Rina finished the onsite', 'Rina finished the onsite')
    await open(title, title.replace('#', ''))
    await expect(suggestion).toHaveCount(0)
    expect(fake.messages(channel).some((message) => message.text === 'please chek the the report')).toBe(true)
    expect(updates()).toBe(updatesBefore + 1)

    await juno.topic.send('the report is ready')
    await juno.topic.expectSent('the report is ready')
    await expect.poll(() => {
      const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'), { readOnly: true })
      try { return db.prepare("SELECT summary FROM ai_calls WHERE feature = 'grammarCheck' ORDER BY id DESC LIMIT 1").get()?.['summary'] }
      finally { db.close() }
    }, { timeout: 10_000 }).toBe('No fixes')
    await expect(suggestion).toHaveCount(0)
  })
}, { engine: { fakeAiDelayMillis: 2_000 }, timeout: 120_000 })
