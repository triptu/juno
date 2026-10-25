// A thread always shows its root first (spec section 7). Start thread on a
// Main message with no replies opens a thread whose root is that stored
// message, at once and without an empty state; the first reply lands under
// it, with no second copy of the root and no move.
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

/** Records, from now on, whether the topic ever showed an empty or loading state. */
async function watchEmpty(win: Page): Promise<() => Promise<string[]>> {
  await win.evaluate(() => {
    const seen: string[] = []
    ;(globalThis as unknown as { emptySeen: string[] }).emptySeen = seen
    const check = () => {
      for (const view of document.querySelectorAll('[data-topic-view]')) {
        const text = view.textContent ?? ''
        for (const phrase of ['No messages yet', 'Loading messages']) if (text.includes(phrase) && !seen.includes(phrase)) seen.push(phrase)
      }
    }
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  return () => win.evaluate(() => (globalThis as unknown as { emptySeen: string[] }).emptySeen)
}

const top = async (row: Locator) => (await row.boundingBox())?.y

async function startThreadOn(juno: Juno, open: () => Promise<void>, text: string, reply: string): Promise<void> {
  await open()
  const { topic } = juno
  await topic.expectTitle('Main')
  const menu = await topic.messageMenu(text)
  const seen = await watchEmpty(juno.win)
  await menu.choose('reply')

  // The root shows as soon as the thread does, before any reply.
  await expect(topic.composer).toHaveAttribute('placeholder', 'Reply')
  const rows = topic.list.locator('[data-message-row]')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(text)
  expect(await seen()).toEqual([])

  // The first reply goes under it; the root stays where it was, once.
  const before = await top(topic.message(text))
  await topic.send(reply)
  await topic.expectSent(reply)
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText(text)
  await expect(rows.nth(1)).toContainText(reply)
  expect(await top(topic.message(text))).toBe(before)
  expect(await seen()).toEqual([])
}

// Signed in once; each step starts its own thread, so the row counts are per topic.
test('Start thread on a message with no replies, in a channel, a DM and a group DM, shows it as the root', async ({ juno, fake }) => {
  await test.step('Start thread on a channel message with no replies shows it as the root, then the reply under it', async () => {
    const text = 'Yes, both rotations move together.'
    await startThreadOn(juno, () => juno.sidebar.row('#eng').open(), text, 'Calendar updated for both.')
    const root = fake.messages('C0ENG').find((m) => m.text === text)!
    expect(fake.messages('C0ENG').filter((m) => m.thread_ts === root.ts && m.ts !== root.ts).map((m) => m.text)).toEqual(['Calendar updated for both.'])
  })

  await test.step('Start thread on a DM message with no replies shows it as the root, then the reply under it', async () => {
    const text = 'Running 5 late to the planning sync'
    await startThreadOn(juno, () => juno.sidebar.row('Maya', { exact: true }).open(), text, 'See you there.')
    const root = fake.messages('D0MAYA').find((m) => m.text === text)!
    expect(fake.messages('D0MAYA').filter((m) => m.thread_ts === root.ts && m.ts !== root.ts).map((m) => m.text)).toEqual(['See you there.'])
  })

  await test.step('Start thread on a group DM message with no replies shows it as the root', async () => {
    await startThreadOn(juno, () => juno.win.locator('[data-topic-id="m:G0MAYALEO"]').click(), 'lunch friday?', 'Booked for 12:30.')
  })
})
