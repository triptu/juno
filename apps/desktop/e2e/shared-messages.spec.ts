// A message shared from another conversation (spec section 7, "Shared
// messages"): its card says where it was posted, from Juno's own data, and
// that place opens the original message in its topic, which flashes. A
// conversation Juno does not have keeps Slack's footer, which opens the
// message's Slack link outside.
import { sharedMessage, type FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

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

/** Records which message rows flash from now on: the flash is a short animation on the row. */
async function watchFlashes(juno: Juno): Promise<void> {
  await juno.win.evaluate(() => {
    const w = window as unknown as { __flashed: string[] }
    w.__flashed = []
    const animate = Element.prototype.animate
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      if ((this as HTMLElement).dataset['messageRow'] !== undefined) w.__flashed.push(this.textContent ?? '')
      return animate.apply(this, args)
    }
  })
}

async function openProduct(juno: Juno) {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#product').open()
  const card = (words: string) => juno.topic.message(words).locator('section[aria-label="Attachment"]')
  await expect(card('Sharing the reaper reply')).toBeVisible({ timeout: 15_000 })
  return card
}

test('a shared message says where it was posted, and its place opens the message in its topic', async ({ juno, fake }) => {
  seedShares(fake)
  const card = await openProduct(juno)
  const { topic, tabs } = juno

  // The place comes from Juno's data, not Slack's generic footer.
  const reply = card('Sharing the reaper reply')
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
  await watchFlashes(juno)
  await link.click()
  await tabs.expectCount(2)
  await expect(topic.message('Please do.')).toBeInViewport({ timeout: 15_000 })
  await expect.poll(() => juno.win.evaluate(() => (window as unknown as { __flashed: string[] }).__flashed.some((row) => row.includes('Please do.'))), { timeout: 10_000 }).toBe(true)
})

test("a message shared from a conversation Juno does not have keeps Slack's footer, which opens outside", async ({ juno, fake }) => {
  seedShares(fake)
  const card = await openProduct(juno)
  const closed = card('Sharing a closed room')
  await closed.scrollIntoViewIfNeeded()
  await expect(closed.locator('[data-shared-source]')).toHaveCount(0)
  const link = closed.getByRole('link', { name: 'Thread in Slack conversation' })
  await link.click()
  await juno.expectToast('Juno cannot reach that conversation · Opened in the browser')
  await expect.poll(() => juno.browserLinks()).toContain(`${fake.url}/archives/C0NOWHERE/p${NOWHERE.replace('.', '')}`)
  await juno.tabs.expectCount(1)
})
