// Forward (spec section 7, "Forward"): the message menu's Forward… opens
// the sheet, a channel is picked and a note added, and the message lands in
// the channel as a shared message under the note, sent once with
// `chat.shareMessage`. A forward Slack refuses shows the usual "Not sent."
// in the destination, and Retry sends it. F on a focused message opens the
// sheet too, and chooses Forward… in the open menu.
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const HANDOFF = 'Reminder: on-call handoff moves to Mondays'

const sheet = (win: Page) => win.locator('[data-forward-sheet]')

/** Forward… on `text` in the open topic, then `destination` from the list and `note` (Shift-Enter between its lines), and Enter. */
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
  const [first = '', ...more] = note.split('\n')
  await field.fill(first)
  const oneLine = (await field.boundingBox())!.height
  for (const line of more) {
    await field.press('Shift+Enter')
    await field.pressSequentially(line)
  }
  await expect(field).toHaveValue(note)
  // The note wraps and grows with its lines.
  if (more.length > 0) expect((await field.boundingBox())!.height).toBeGreaterThan(oneLine)
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
  expect(labels.indexOf('Forward…')).toBe(labels.indexOf('Open in Slack') - 1)
  expect(labels).not.toContain('Copy Slack link')

  await forward(juno, HANDOFF, 'product', 'For the roadmap review\nThe second point matters most')
  await juno.expectToast('Forwarded to #product')
  await juno.win.getByRole('status').getByRole('button', { name: 'Open' }).click()
  await juno.topic.expectTitle('Main')
  await juno.topic.expectSent('For the roadmap review')
  const forwarded = juno.topic.message('For the roadmap review')
  await expect(forwarded.getByRole('region', { name: 'Attachment' })).toContainText(HANDOFF)
  // The card names the place it was forwarded from, as any shared message's card does.
  await expect(forwarded.locator('[data-shared-source]')).toHaveText('eng')

  const shares = fake.calls.filter((call) => call.method === 'chat.shareMessage')
  expect(shares).toHaveLength(1)
  expect(shares[0]!.args).toMatchObject({ channel: 'C0ENG', share_channel: 'C0PRODUCT', text: '' })
  const stored = fake.messages('C0PRODUCT').at(-1)!
  expect(stored.text).toBe('For the roadmap review\nThe second point matters most')
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
  // The pending card already has the footer Slack's copy will have.
  await expect(failed.row.locator('[data-shared-source]')).toHaveText('eng')

  await failed.retry()
  await juno.topic.expectSent('This one is refused first')
  expect(fake.messages('C0PRODUCT').filter((message) => message.text === 'This one is refused first')).toHaveLength(1)
})

test('F forwards a focused message, and chooses Forward… in its open menu', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
  const dialog = sheet(juno.win)
  const row = juno.topic.message(HANDOFF)

  await row.locator('[data-msg-text]').first().click()
  await expect(row).toBeFocused()
  await row.press('f')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-forward-preview]')).toContainText(HANDOFF)
  await juno.win.keyboard.press('Escape')
  await juno.win.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  const menu = await juno.messageMenu.openOnRow(row)
  expect((await menu.shortcuts())['forward']).toBe('F')
  await juno.win.keyboard.press('f')
  await expect(menu.root).toHaveCount(0)
  await expect(dialog).toBeVisible()
})
