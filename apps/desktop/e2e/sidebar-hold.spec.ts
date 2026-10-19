// The sidebar holds its order while the pointer or keyboard focus is in the
// topic list (SPEC 5, "Holding the order"): new activity updates a row in
// place but does not move it, so a press lands on the row it was aimed at.
// Leaving the list applies the new order in one step.
import { expect, test } from './fixtures'
import { pointAt, press, type Juno } from './driver/juno'
import type { FakeSlack } from '@juno/fake-slack'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

test.describe.configure({ timeout: 60_000 })

/** The Recent section's topic ids, top to bottom. */
function recentIds(juno: Juno): Promise<string[]> {
  return juno.sidebar.section('Recent').locator('[data-topic-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-topic-id') ?? ''))
}

function rowOf(juno: Juno, id: string) {
  return juno.sidebar.list.locator(`[data-topic-id="${id}"]`)
}

async function titleOf(juno: Juno, id: string): Promise<string> {
  return rowOf(juno, id).evaluate((row) => document.getElementById(row.getAttribute('aria-labelledby') ?? '')?.textContent ?? '')
}

/** The two oldest threads in Recent, below `above`: new replies would move them to the top. */
function oldestThreads(ids: ReadonlyArray<string>, above: number): [string, string] {
  const threads = ids.slice(above + 1).filter((id) => id.startsWith('t:'))
  expect(threads.length).toBeGreaterThanOrEqual(2)
  return [threads.at(-2)!, threads.at(-1)!]
}

/** A reply from another client in each thread, the second one newest; waits until each row shows it in place. */
async function replyIn(juno: Juno, fake: FakeSlack, threads: ReadonlyArray<string>): Promise<void> {
  for (const [i, id] of threads.entries()) {
    const [, channel, threadTs] = id.split(':')
    fake.injectMessage({ channel: channel!, threadTs: threadTs!, user: 'U0LEO', text: `Held reply ${i}` })
  }
  for (const [i, id] of threads.entries()) await expect(rowOf(juno, id)).toContainText(`Held reply ${i}`, { timeout: 15_000 })
}

/** Every mover is above `target` in Recent. */
async function expectMovedAbove(juno: Juno, movers: ReadonlyArray<string>, target: string): Promise<void> {
  await expect.poll(async () => {
    const ids = await recentIds(juno)
    return movers.every((id) => ids.indexOf(id) >= 0 && ids.indexOf(id) < ids.indexOf(target))
  }).toBe(true)
}

test('under the pointer, new activity does not move rows, and a press opens the row pointed at', async ({ juno, win, fake }) => {
  const target = (await recentIds(juno))[1]!
  const title = await titleOf(juno, target)
  await pointAt(win, rowOf(juno, target), { x: 40, y: 20 })
  // From here the list holds.
  const before = await recentIds(juno)
  const movers = oldestThreads(before, before.indexOf(target))
  await replyIn(juno, fake, movers)
  // The rows show the replies where they are; nothing moved under the pointer.
  expect(await recentIds(juno)).toEqual(before)

  await press(win)
  await juno.topic.expectTitle(title)
  await expect(rowOf(juno, target)).toHaveAttribute('aria-current', 'true')

  // Leaving the list applies the new order in one step, and the selection stays.
  await juno.sidebar.leave()
  await expectMovedAbove(juno, movers, target)
  const after = await recentIds(juno)
  expect(after.indexOf(movers[1])).toBeLessThan(after.indexOf(movers[0]))
  await expect(rowOf(juno, target)).toHaveAttribute('aria-current', 'true')
})

test('with keyboard focus in the list, the arrows walk the held order', async ({ juno, win, fake }) => {
  const before = await recentIds(juno)
  const target = before[2]!
  const movers = oldestThreads(before, 2)
  const title = await titleOf(juno, target)

  // Open the first row, move the pointer away, and walk down with the keyboard.
  await pointAt(win, rowOf(juno, before[0]!), { x: 40, y: 20 })
  await press(win)
  await juno.topic.expectTitle(await titleOf(juno, before[0]!))
  await juno.sidebar.leave()
  await rowOf(juno, before[0]!).focus()
  await win.keyboard.press('ArrowDown')
  await expect(rowOf(juno, before[1]!)).toBeFocused()
  expect(await recentIds(juno)).toEqual(before)

  await replyIn(juno, fake, movers)
  expect(await recentIds(juno)).toEqual(before)

  await win.keyboard.press('ArrowDown')
  await expect(rowOf(juno, target)).toBeFocused()
  await win.keyboard.press('Enter')
  await juno.topic.expectTitle(title)
  expect(await recentIds(juno)).toEqual(before)

  // Focus leaving the list applies the new order; the opened row stays selected.
  await juno.topic.composer.click()
  await expectMovedAbove(juno, movers, target)
  await expect(rowOf(juno, target)).toHaveAttribute('aria-current', 'true')
})

test('your own send moves its row at once while the list holds', async ({ juno, win, fake }) => {
  const before = await recentIds(juno)
  const [, mine] = oldestThreads(before, 0)
  await pointAt(win, rowOf(juno, mine), { x: 40, y: 20 })
  await press(win)
  await juno.topic.composer.fill('My own reply')
  await win.keyboard.press('Enter')
  // The pointer is still on the list, but the send was yours, so its row goes to the top of Recent.
  await expect.poll(() => recentIds(juno).then((ids) => ids[0])).toBe(mine)
  // Another client's reply still waits.
  const [other] = oldestThreads(await recentIds(juno), 0)
  const held = await recentIds(juno)
  await replyIn(juno, fake, [other])
  expect(await recentIds(juno)).toEqual(held)
})
