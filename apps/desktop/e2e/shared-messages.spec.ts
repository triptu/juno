// A message shared from another conversation (spec section 7, "Shared
// messages"): its card says where it was posted, from Juno's own data, and
// that place opens the original message in its topic, which flashes. A
// conversation Juno does not have keeps Slack's footer, which opens the
// message's Slack link outside. A shared message of only files shows its
// files, never Slack's "[date] name: file" fallback line.
import { sharedMessage, type FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import { watchFlashes } from './driver/flashes'

test.describe.configure({ timeout: 120_000 })

const NOWHERE = '1712345678.000200'

const find = (fake: FakeSlack, channel: string, start: string) => fake.messages(channel).find((message) => message.text?.includes(start))!

/** Shares a reply from #eng's Postgres thread, a #leadership message and one from a conversation Juno does not have into #product. */
function seedShares(fake: FakeSlack): void {
  const share = (channel: string, message: Parameters<typeof sharedMessage>[2], words: string) =>
    fake.workspace.post({ channel: 'C0PRODUCT', user: 'U0SAM', text: words, attachments: [sharedMessage(fake.url, channel, message, 'Maya')], silent: true })
  share('C0ENG', find(fake, 'C0ENG', 'Please do.'), 'Sharing the reaper reply')
  share('C0LEADERSHIP', find(fake, 'C0LEADERSHIP', 'Retro notes are in the doc.'), 'Sharing the retro note')
  share('C0NOWHERE', { ts: NOWHERE, user: 'U0MAYA', text: 'Notes from a closed room' }, 'Sharing a closed room')
}

test('shared message cards: a video share names its video, the place says where it was posted, and a place Juno does not have opens outside', async ({ juno, fake }) => {
  seedShares(fake)
  const clip = fake.injectMedia({ channel: 'C0ENG', user: 'U0MAYA', media: [{ name: 'screen-recording.mp4', width: 1280, height: 720, kind: 'video' }] })
  // Forwarded with no note: the sharing message has no words of its own. It is the newest in #product.
  fake.workspace.post({ channel: 'C0PRODUCT', user: 'U0SAM', text: '', attachments: [sharedMessage(fake.url, 'C0ENG', clip, 'Maya')], silent: true })
  await juno.signIn()
  await juno.waitForSync()
  const { topic, tabs } = juno
  const card = (words: string) => topic.message(words).locator('section[aria-label="Attachment"]')

  await test.step("a shared message of only a video shows the video, and its row names it, not Slack's fallback line", async () => {
    const row = juno.sidebar.row('#product')
    await row.expectPreview(/Shared message: Video$/)
    await row.open()

    const video = topic.list.locator('section[aria-label="Attachment"]').filter({ has: juno.win.locator('[data-inline-video]') })
    await expect(video).toBeVisible({ timeout: 15_000 })
    await expect(video.getByLabel('screen-recording.mp4', { exact: true })).toBeVisible()
    await expect(video).not.toContainText('Maya: screen-recording.mp4')
    await expect(video.locator('[data-shared-source]')).toHaveText('eng')
    // The video is drawn once, in the card, not again under it.
    const message = topic.list.locator('[data-message-row]').filter({ has: juno.win.locator('section[aria-label="Attachment"] [data-inline-video]') })
    await expect(message.locator('[data-inline-video]')).toHaveCount(1)
  })

  // Before the in-app link below, which opens a second tab.
  await test.step("a message shared from a conversation Juno does not have keeps Slack's footer, which opens outside", async () => {
    const closed = card('Sharing a closed room')
    await closed.scrollIntoViewIfNeeded()
    await expect(closed.locator('[data-shared-source]')).toHaveCount(0)
    const link = closed.getByRole('link', { name: 'Thread in Slack conversation' })
    await link.click()
    await juno.expectToast('Juno cannot reach that conversation · Opened in the browser')
    await expect.poll(() => juno.browserLinks()).toContain(`${fake.url}/archives/C0NOWHERE/p${NOWHERE.replace('.', '')}`)
    await tabs.expectCount(1)
  })

  await test.step('a shared message says where it was posted, and its place opens the message in its topic', async () => {
    // The place comes from Juno's data, not Slack's generic footer.
    const reply = card('Sharing the reaper reply')
    await reply.scrollIntoViewIfNeeded()
    await expect(reply.locator('[data-shared-source]')).toHaveText('Thread in eng')
    await expect(reply).not.toContainText('Slack conversation')
    const retro = card('Sharing the retro note').locator('[data-shared-source]')
    await expect(retro).toHaveText('leadership')
    await expect(retro.getByRole('img', { name: 'Private channel' })).toBeVisible()

    // The place is a link inside Juno: hover says where it goes, a click opens the reply in its thread, which flashes.
    const link = reply.locator('a:has([data-shared-source])')
    await expect(link).toHaveAttribute('data-in-app', '')
    await link.hover()
    await expect(link).toHaveAttribute('title', '#eng · Thread')
    const flashed = await watchFlashes(juno.win)
    await link.click()
    await tabs.expectCount(2)
    await expect(topic.message('Please do.')).toBeInViewport({ timeout: 15_000 })
    await expect.poll(async () => (await flashed()).some((row) => row.includes('Please do.')), { timeout: 10_000 }).toBe(true)
  })
})
