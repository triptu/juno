import type { FakeSlack } from '@juno/fake-slack'
import type { Page } from '@playwright/test'
import type { Juno } from './driver/juno'
import { expect } from './fixtures'

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

// A thread always shows its root first (spec section 7). Start thread on a Main message with no replies opens a
// thread whose root is that stored message, at once and without an empty state; the first reply lands under it,
// with no second copy of the root and no move. A DM and a group DM are the same TopicView.
export async function startThread(juno: Juno, fake: FakeSlack): Promise<void> {
  const { topic } = juno
  const text = 'Yes, both rotations move together.'
  const reply = 'Calendar updated for both.'
  await juno.sidebar.row('#eng').open()
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
  const before = (await topic.message(text).boundingBox())?.y
  await topic.send(reply)
  await topic.expectSent(reply)
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText(text)
  await expect(rows.nth(1)).toContainText(reply)
  expect((await topic.message(text).boundingBox())?.y).toBe(before)
  expect(await seen()).toEqual([])
  const root = fake.messages('C0ENG').find((m) => m.text === text)!
  expect(fake.messages('C0ENG').filter((m) => m.thread_ts === root.ts && m.ts !== root.ts).map((m) => m.text)).toEqual([reply])
}

