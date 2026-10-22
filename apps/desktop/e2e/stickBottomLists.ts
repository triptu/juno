// The lists the stick-bottom tests start from, and the ways a user reaches their end.
import { expect, type Locator, type Page } from '@playwright/test'
import { startFakeSlack, topic300Seed, type FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import type { Slack } from './driver/slack'
import { test } from './fixtures'

export const frames = (page: Page, count: number) =>
  page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
    count,
  )

export const distance = (scroller: Locator) => scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)

/** Turns the wheel down over a list already at its end, as a user sitting there does: nothing scrolls. */
export async function wheelDownAtEnd(page: Page, scroller: Locator): Promise<void> {
  const box = await scroller.boundingBox()
  if (box === null) throw new Error('No list to turn the wheel over')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 400)
  await frames(page, 10)
  expect(await distance(scroller)).toBeLessThanOrEqual(1)
}

/** Turns the wheel down over the list until it reaches its end, as a user scrolling back down does. */
export async function wheelToEnd(page: Page, scroller: Locator): Promise<void> {
  const box = await scroller.boundingBox()
  if (box === null) throw new Error('No list to turn the wheel over')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 20 && (await distance(scroller)) > 1; i++) {
    await page.mouse.wheel(0, 300)
    await frames(page, 4)
  }
  await expect.poll(() => distance(scroller)).toBeLessThanOrEqual(1)
  await frames(page, 10)
}

/**
 * Drags the scrollbar thumb to the end of the list and keeps the button down, as a user still holding it does. The
 * scroll has not ended until the button is let go. The track starts below the header band (`global.css`).
 */
export async function holdThumbAtEnd(page: Page, scroller: Locator): Promise<void> {
  const thumb = await scroller.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const band = Number.parseFloat(getComputedStyle(node).scrollPaddingTop) || 0
    const track = node.clientHeight - band
    return { x: box.right - 5, y: box.top + band + ((node.scrollTop + node.clientHeight / 2) / node.scrollHeight) * track }
  })
  await page.mouse.move(thumb.x, thumb.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(thumb.x, thumb.y + i * 80)
  await expect.poll(() => distance(scroller)).toBeLessThanOrEqual(1)
}

/** The last row holds `text` and is fully in the list, above the composer. */
export async function expectLastWhole(juno: Juno, text: string): Promise<void> {
  const last = juno.topic.list.locator('[data-message-row]').last()
  await expect(last).toContainText(text)
  const [row, list, composer] = await Promise.all([last.boundingBox(), juno.topic.scroller.boundingBox(), juno.topic.composer.boundingBox()])
  expect(row!.y).toBeGreaterThanOrEqual(list!.y - 1)
  expect(row!.y + row!.height).toBeLessThanOrEqual(Math.min(list!.y + list!.height, composer!.y) + 1)
}


export const longerThanView = (scroller: Locator) => scroller.evaluate((node) => node.scrollHeight > node.clientHeight * 1.5)

/** #eng's Main with 30 more messages than the seed, open at its end. */
export async function openLongMain(juno: Juno, fake: FakeSlack, slack: Slack): Promise<string> {
  const channel = slack.channel('eng')
  for (let i = 0; i < 30; i++) fake.workspace.post({ channel, user: slack.as(i % 2 === 0 ? 'Maya' : 'Leo').id, text: `Earlier message ${i}`, silent: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectMessage('Earlier message 29')
  await juno.topic.toLatest()
  expect(await longerThanView(juno.topic.scroller)).toBe(true)
  return channel
}

/** The topic300 seed: Main and a thread of 300 messages each, twice the 150 rows a topic read to its end opens with. */
export const longTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
    await use(fake)
    await fake.close()
  },
})
