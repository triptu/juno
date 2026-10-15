// Sidebar views against the fake Slack (SPEC 5 "Views", inventory 2.3,
// 15.7 and 15.8): making a view with and without an icon, keeping its
// channels out of All, the mention dot, editing, reordering by menu and by
// drag, deleting with Undo, Add to view from a channel's menu, and a row of
// many views that scrolls sideways without moving the list. The built-in
// Automated view is deleted first where a test needs the bot channels in All
// or only its own views (automated.spec.ts covers Automated itself).
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

test.describe.configure({ timeout: 90_000 })

const ALERTS_MAIN = '#alerts-prod'
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'

/** Signs in, waits for the sync and deletes Automated, which holds #alerts-prod and #deploys after the first sync. */
async function withoutAutomated(juno: Juno): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.viewMenu('Automated', 'view-delete')
  await expect.poll(() => juno.sidebar.viewNames()).toEqual([])
}

test('a view with an icon gathers its channel, keeps it out of All, and lights only for a mention', async ({ juno, fake }) => {
  await withoutAutomated(juno)
  const { sidebar } = juno
  await sidebar.row(ALERTS_MAIN).expectVisible()

  await sidebar.createView({ name: 'Bots', icon: 'Robot', conversations: ['alerts-prod'], keepOutOfAll: true })
  // An icon pill: the name is its tooltip and accessible name, not its text.
  const bots = sidebar.viewPill('Bots')
  await expect(bots).toHaveAttribute('title', 'Bots')
  await expect(bots).toHaveText('')
  // Saved and selected: only the view's channel.
  await sidebar.row(ALERTS_MAIN).expectVisible()
  await sidebar.row(POSTGRES).expectAbsent()

  // Out of All and out of Channels; Channels' dot does not count it.
  await sidebar.filter('All')
  await sidebar.row(ALERTS_MAIN).expectAbsent()
  await sidebar.row(POSTGRES).expectVisible()
  await sidebar.filter('Channels')
  await sidebar.row(ALERTS_MAIN).expectAbsent()
  await sidebar.filter('All')

  // Plain unread does not light the view; a mention does.
  fake.injectMessage({ channel: 'C0ALERTSPROD', user: 'U0LEO', text: 'Disk at 81% on db-2.' })
  await sidebar.selectView('Bots')
  await sidebar.row(ALERTS_MAIN).expectPreview('Leo: Disk at 81% on db-2.')
  await sidebar.filter('All')
  await sidebar.expectViewDot('Bots', false)
  fake.injectMessage({ channel: 'C0ALERTSPROD', user: 'U0LEO', text: '<@U0TUSHAR> can you take the pager tonight?' })
  await sidebar.expectViewDot('Bots', true)
  // Never on the selected pill.
  await sidebar.selectView('Bots')
  await sidebar.expectViewDot('Bots', false)
})

test('a view with no icon shows its name; edit it, reorder by menu and drag, and delete it with Undo', async ({ juno }) => {
  await withoutAutomated(juno)
  const { sidebar } = juno

  await sidebar.createView({ name: 'Team', conversations: ['eng'] })
  await expect(sidebar.viewPill('Team')).toHaveText('Team')
  await sidebar.row(POSTGRES).expectVisible()
  await sidebar.row(RINA).expectAbsent()
  await sidebar.createView({ name: 'Hiring', conversations: ['hiring'] })
  await sidebar.row(RINA).expectVisible()
  expect(await sidebar.viewNames()).toEqual(['Team', 'Hiring'])

  // Edit: the sheet opens with the view as it is; a new name and a second channel.
  await sidebar.viewMenu('Team', 'view-edit')
  await expect(sidebar.viewSheet.getByRole('textbox', { name: 'Name' })).toHaveValue('Team')
  await expect(sidebar.viewSheet.getByRole('option', { name: 'eng', exact: true })).toHaveAttribute('aria-selected', 'true')
  await sidebar.fillViewSheet({ name: 'Eng team', conversations: ['hiring'] })
  await sidebar.viewSheet.getByRole('button', { name: 'Save' }).click()
  await expect(sidebar.viewPill('Eng team')).toHaveText('Eng team')
  await sidebar.selectView('Eng team')
  await sidebar.row(POSTGRES).expectVisible()
  await sidebar.row(RINA).expectVisible()

  // Move right by the menu; Move left is disabled on the first view.
  const labels = await sidebar.viewMenu('Eng team', 'view-right')
  expect(labels).toEqual(['Edit view…', '(Move left)', 'Move right', '-', 'Delete view'])
  await expect.poll(() => sidebar.viewNames()).toEqual(['Hiring', 'Eng team'])

  // Drag it back before Hiring.
  await sidebar.viewPill('Eng team').dragTo(sidebar.viewPill('Hiring'), { targetPosition: { x: 4, y: 14 } })
  await expect.poll(() => sidebar.viewNames()).toEqual(['Eng team', 'Hiring'])

  // Delete the selected view: All takes over, the toast offers Undo, and Undo puts it back in its place.
  await sidebar.viewMenu('Eng team', 'view-delete')
  await juno.expectToast('Deleted view · Eng team')
  await expect.poll(() => sidebar.viewNames()).toEqual(['Hiring'])
  await expect(sidebar.filterButton('All')).toHaveAttribute('aria-pressed', 'true')
  await juno.undoFromToast()
  await expect.poll(() => sidebar.viewNames()).toEqual(['Eng team', 'Hiring'])
  await sidebar.selectView('Eng team')
  await sidebar.row(RINA).expectVisible()
})

test('Add to view on a channel’s menu adds and removes it, with Undo, and New view… starts with it', async ({ juno }) => {
  await withoutAutomated(juno)
  const { sidebar } = juno
  await sidebar.createView({ name: 'Ops', conversations: ['eng'] })
  const ops = await sidebar.viewId('Ops')
  await sidebar.filter('All')

  const { labels } = await sidebar.row(ALERTS_MAIN).chooseInMenu(`view-add:${ops}`)
  expect(labels).toContain('Add to view')
  expect(labels).toContain('> Ops')
  expect(labels).toContain('> New view…')
  await juno.expectToast('Added #alerts-prod to Ops')
  await sidebar.selectView('Ops')
  await sidebar.row(ALERTS_MAIN).expectVisible()

  // The menu now checks Ops; choosing it removes the channel. Undo adds it back.
  const again = await sidebar.row(ALERTS_MAIN).chooseInMenu(`view-remove:${ops}`)
  expect(again.labels).toContain('> Ops ✓')
  await juno.expectToast('Removed #alerts-prod from Ops')
  await sidebar.row(ALERTS_MAIN).expectAbsent()
  await juno.undo()
  await sidebar.row(ALERTS_MAIN).expectVisible()

  // The channel menu on a topic's context pill offers the same submenu.
  await sidebar.filter('All')
  await sidebar.row(POSTGRES).open()
  await juno.chooseNextMenuItem(`view-remove:${ops}`)
  await juno.topic.contextPill.click({ button: 'right' })
  await juno.expectToast('Removed #eng from Ops')
  await juno.undoFromToast()
  await sidebar.selectView('Ops')
  await sidebar.row(POSTGRES).expectVisible()

  // New view… opens the sheet with the channel already chosen.
  await sidebar.row(ALERTS_MAIN).chooseInMenu('view-new')
  await expect(sidebar.viewSheet).toBeVisible()
  await expect(sidebar.viewSheet.getByRole('option', { name: 'alerts-prod', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(sidebar.viewSheet.getByText('1 conversation')).toBeVisible()
  await sidebar.viewSheet.getByRole('button', { name: 'Cancel' }).click()
  await expect(sidebar.viewSheet).toHaveCount(0)
})

test('many views scroll the pill row sideways with the wheel, and the row and the list stay where they are', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
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
