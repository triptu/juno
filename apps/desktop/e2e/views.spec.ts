// Sidebar views in the browser (SPEC 5 "Views"): a pill dragged to a new
// place, and a row of many views that scrolls sideways without moving the
// list. Making, editing, reordering by menu, deleting, Add to view, the
// mention dot, the icon's colour and the empty view are in the DOM lane
// (`dom/views.test.ts`); automated.spec.ts covers Automated itself.
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true, synced: true })

test.describe.configure({ timeout: 90_000 })

/** Deletes Automated, which holds #alerts-prod and #deploys after the first sync. */
async function withoutAutomated(juno: Juno): Promise<void> {
  await juno.sidebar.viewMenu('Automated', 'view-delete')
  await expect.poll(() => juno.sidebar.viewNames()).toEqual([])
}

test('a pill drags to a new place, and many views scroll the pill row sideways', async ({ juno }) => {
  const { sidebar } = juno
  await withoutAutomated(juno)
  await test.step('a pill dragged before another takes its place', async () => {
    await sidebar.createView({ name: 'Team', conversations: ['eng'] })
    await sidebar.createView({ name: 'Hiring', conversations: ['hiring'] })
    await sidebar.viewPill('Hiring').dragTo(sidebar.viewPill('Team'), { targetPosition: { x: 4, y: 14 } })
    await expect.poll(() => sidebar.viewNames()).toEqual(['Hiring', 'Team'])
  })
  // Show All again, as at launch, so the next step measures the row and list as they were.
  await sidebar.filter('All')
  await test.step('many views scroll the pill row sideways with the wheel, and the row and the list stay where they are', async () => {
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
  })
})

