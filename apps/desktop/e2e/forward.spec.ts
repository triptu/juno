// Forward (spec section 7, "Forward"): the message menu's Forward… opens
// the sheet, a channel is picked and a note added, and the message lands in
// the channel as a shared message under the note, sent once with
// `chat.shareMessage`. A forward Slack refuses shows the usual "Not sent."
// in the destination, and Retry sends it.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const HANDOFF = 'Reminder: on-call handoff moves to Mondays'

const sheet = (win: Page) => win.locator('[data-forward-sheet]')

/** Forward… on `text` in the open topic, then `destination` from the list and `note`, and Enter. */
async function forward(juno: Juno, text: string, destination: string, note: string): Promise<void> {
  await juno.topic.chooseInMessageMenu(text, 'forward')
  const dialog = sheet(juno.win)
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-forward-preview]')).toContainText(text)
  // The list is open with the sheet: typing searches at once, Enter picks and moves to the note.
  await juno.win.getByPlaceholder('Search people and channels').fill(destination)
  await juno.win.getByPlaceholder('Search people and channels').press('Enter')
  await expect(dialog.getByRole('button', { name: `Send to: #${destination}` })).toBeVisible()
  const field = dialog.getByRole('textbox', { name: 'Note' })
  await expect(field).toBeFocused()
  await field.fill(note)
  await field.press('Enter')
  await expect(dialog).toHaveCount(0)
}

test('Forward… shares a message into a channel with a note', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')

  const { labels } = await juno.topic.chooseInMessageMenu(HANDOFF, null)
  expect(labels.indexOf('Forward…')).toBeGreaterThan(-1)
  expect(labels.indexOf('Forward…')).toBe(labels.indexOf('Copy Slack link') - 1)

  await forward(juno, HANDOFF, 'product', 'For the roadmap review')
  await juno.expectToast('Forwarded to #product')
  await juno.win.getByRole('status').getByRole('button', { name: 'Open' }).click()
  await juno.topic.expectTitle('Main')
  await juno.topic.expectSent('For the roadmap review')
  const forwarded = juno.topic.message('For the roadmap review')
  await expect(forwarded.getByRole('region', { name: 'Attachment' })).toContainText(HANDOFF)

  const shares = fake.calls.filter((call) => call.method === 'chat.shareMessage')
  expect(shares).toHaveLength(1)
  expect(shares[0]!.args).toMatchObject({ channel: 'C0ENG', share_channel: 'C0PRODUCT', text: '' })
  const stored = fake.messages('C0PRODUCT').at(-1)!
  expect(stored.text).toBe('For the roadmap review')
  expect(stored.attachments?.[0]).toMatchObject({ is_msg_unfurl: true, text: expect.stringContaining(HANDOFF) })
})

test('a forward Slack refuses shows Not sent. in the destination, and Retry sends it', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')

  fake.forceError({ method: 'chat.shareMessage', error: 'restricted_action', times: 1 })
  await forward(juno, HANDOFF, 'product', 'This one is refused first')
  await juno.win.getByRole('status').getByRole('button', { name: 'Open' }).click()
  const failed = juno.topic.failed('This one is refused first')
  await expect(failed.row).toContainText('Not sent.')
  await expect(failed.row.getByRole('region', { name: 'Attachment' })).toContainText(HANDOFF)

  await failed.retry()
  await juno.topic.expectSent('This one is refused first')
  expect(fake.messages('C0PRODUCT').filter((message) => message.text === 'This one is refused first')).toHaveLength(1)
})
