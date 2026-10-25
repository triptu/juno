// Send checks with a mention in the field (SPEC 8, "Send checks"). The other send checks are in
// the DOM lane (`dom/send-checks.test.ts`); picking a mention needs the browser's editing.
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

const POSTGRES = 'Draft plan is in the doc'

const posts = (fake: { calls: ReadonlyArray<{ method: string; args: Record<string, unknown> }> }) => fake.calls.filter((call) => call.method === 'chat.postMessage')

test('a message with a mention gets its fix line, and Review opens it as the field showed it', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.composer.pressSequentially('Thanks @ma')
  await expect(topic.suggestion('Maya')).toBeVisible()
  await topic.composer.press('Enter')
  await topic.composer.pressSequentially('the the build is green')
  await topic.composer.press('Enter')
  await topic.expectSent('Thanks')
  expect(posts(fake).map((call) => call.args['text'])).toEqual(['Thanks <@U0MAYA> the the build is green'])
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toContainText('the the → the')
  await suggestion.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Thanks @Maya the build is green')
})
