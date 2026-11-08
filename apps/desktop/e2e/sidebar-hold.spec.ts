// The sidebar in the browser, as one journey from a synced start. A Main row's new-thread count leaves the row's
// height alone. The list holds its order while the pointer
// or keyboard focus is in it (SPEC 5, "Holding the order"): new activity updates a row in place but does not move
// it, so a press lands on the row it was aimed at, and leaving the list applies the new order in one step. A view's
// pill (a view's or Reactions) drags to a new place, and many views scroll the pill row sideways (SPEC 5, "Views"). What it shows after
// sign-in, live updates, the filters, the keyboard, the Unread hold and the rest of views are in the DOM lane
// (`dom/sidebar.test.ts`, `dom/views.test.ts`); zooming, which keeps the sidebar in the window, is main's
// (`break-pass.spec.ts`). The new-thread count itself is engine data (`packages/engine/test/reads.test.ts`).
import { expect, test } from './fixtures'
import { pointAt, press, type Juno } from './driver/juno'
import type { FakeSlack } from '@juno/fake-slack'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

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

// Each step takes its own order and rows from the list as the step before left it.
test('the sidebar: a new-thread count keeps the row height, the order holds under the pointer and keyboard focus, and view pills drag and scroll', async ({ juno, win, fake }) => {
  await test.step('the new-thread count on a Main row keeps the row height, and reading Main clears it', async () => {
    const main = juno.sidebar.row('#eng')
    // #eng was read up to the Postgres plan; the staging bill thread started after it.
    await main.expectNewThreads(1)
    const height = await main.height()
    await main.open()
    await juno.topic.expectTitle('Main')
    await main.expectNoNewThreads()
    expect(await main.height()).toBe(height)
  })
  await test.step('under the pointer, new activity does not move rows, and a press opens the row pointed at', async () => {
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
  await test.step('with keyboard focus in the list, the arrows walk the held order', async () => {
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
  await test.step('your own send moves its row at once while the list holds', async () => {
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
  // Last: it deletes Automated, which changes the list.
  await test.step('a pill dragged before another takes its place, and many views scroll the pill row sideways', () => viewPills(juno))
})

async function viewPills(juno: Juno): Promise<void> {
  const { sidebar } = juno
  // Deletes Automated, which holds #alerts-prod and #deploys after the first sync.
  await sidebar.viewMenu('Automated', 'view-delete')
  await expect.poll(() => sidebar.viewNames()).toEqual([])
  await sidebar.createView({ name: 'Team', conversations: ['eng'] })
  await sidebar.createView({ name: 'Hiring', conversations: ['hiring'] })
  await sidebar.viewPill('Hiring').dragTo(sidebar.viewPill('Team'), { targetPosition: { x: 4, y: 14 } })
  await expect.poll(() => sidebar.viewNames()).toEqual(['Hiring', 'Team'])
  // The Reactions pill starts after the views and drags among them the same way.
  const pills = () => sidebar.root.locator('[data-view-pill], [data-reactions-pill]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  await expect.poll(pills).toEqual(['Hiring', 'Team', 'Reactions'])
  await sidebar.root.locator('[data-reactions-pill]').dragTo(sidebar.viewPill('Hiring'), { targetPosition: { x: 4, y: 14 } })
  await expect.poll(pills).toEqual(['Reactions', 'Hiring', 'Team'])

  // Show All again, as at launch, so the next part measures the row and list as they were.
  await sidebar.filter('All')
  const filters = sidebar.root.getByRole('group', { name: 'Quick filters' })
  const before = { filters: await filters.boundingBox(), list: await sidebar.list.boundingBox() }

  for (const name of ['Bots', 'Design crit', 'Leadership', 'Customer escalations', 'Friends', 'Launch', 'Infra']) await sidebar.createView({ name })
  await sidebar.filter('All')
  const row = sidebar.pillRow
  const geometry = () => row.evaluate((node) => ({ scrollLeft: node.scrollLeft, overflow: node.scrollWidth - node.clientWidth }))
  expect((await geometry()).overflow).toBeGreaterThan(100)
  // The row did not grow and the list did not move.
  expect(await filters.boundingBox()).toEqual(before.filters)
  expect(await sidebar.list.boundingBox()).toEqual(before.list)

  // A vertical wheel over the pills scrolls them sideways; the list keeps its scroll.
  const listTop = await sidebar.list.evaluate((node) => node.scrollTop)
  await row.hover()
  await juno.win.mouse.wheel(0, 400)
  await expect.poll(async () => (await geometry()).scrollLeft).toBeGreaterThan(0)
  expect(await sidebar.list.evaluate((node) => node.scrollTop)).toBe(listTop)
  // At the end, New view is in reach, and further wheeling stays in the row.
  await juno.win.mouse.wheel(0, 2000)
  await expect.poll(async () => { const g = await geometry(); return g.overflow - g.scrollLeft }).toBeLessThan(1)
  await expect(sidebar.root.getByRole('button', { name: 'New view', exact: true })).toBeInViewport()
  expect(await sidebar.list.evaluate((node) => node.scrollTop)).toBe(listTop)
  // Unread stays where it was, at the right.
  await expect(sidebar.unreadToggle).toBeInViewport()
}
