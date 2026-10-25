// Sidebar views (SPEC 5 "Views"): making a view with and without an icon,
// keeping its channels out of All, the mention dot, editing, reordering by
// menu, deleting with Undo, Add to view from a channel's menu, an icon's
// colour across a relaunch and an empty view. The built-in Automated view is
// deleted first where a test needs the bot channels in All or only its own
// views. Dragging a pill and the pill row's sideways scroll are the browser
// lane's (views.spec.ts).
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest, type DomContext } from './test'

const ALERTS_MAIN = '#alerts-prod'
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'

/** The colour user.db holds for the view named `name`, read while the app runs. */
function storedColor(userData: string, teamId: string, name: string): string | null {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'user.db'), { readOnly: true })
  try {
    return (db.prepare('SELECT color FROM sidebar_views WHERE name = ?').get(name) as { color: string | null } | undefined)?.color ?? null
  } finally {
    db.close()
  }
}

/** Deletes Automated, which holds #alerts-prod and #deploys after the first sync. */
async function withoutAutomated(juno: Juno): Promise<void> {
  await juno.sidebar.viewMenu('Automated', 'view-delete')
  await expect.poll(() => juno.sidebar.viewNames()).toEqual([])
}

// One launch: each step makes its own views, and the first deletes its view at the end so the next starts with none.
domTest('views: an icon view keeps its channel out of All and lights for a mention; a named view edits, reorders and deletes with Undo; Add to view on a channel’s menu', async ({ juno, fake, step }) => {
  await withoutAutomated(juno)
  await step('a view with an icon gathers its channel, keeps it out of All, and lights only for a mention', () => iconView({ juno, fake }))
  await step('a view with no icon shows its name; edit it, reorder by menu, and delete it with Undo', () => namedView({ juno }))
  await step('Add to view on a channel’s menu adds and removes it, with Undo, and New view… starts with it', () => addToView({ juno }))
})

domTest('a view icon keeps the colour picked for it across a relaunch, and an empty view says so and opens its sheet', async ({ juno, relaunch, userData, fake, step }) => {
  await withoutAutomated(juno)
  const { sidebar } = juno
  await sidebar.createView({ name: 'Work', icon: 'Briefcase', conversations: ['eng'] })
  await sidebar.createView({ name: 'Bots', icon: 'Robot', color: 'Teal', conversations: ['alerts-prod'] })
  const tint = sidebar.viewPill('Bots').locator('[data-icon-tint]')
  await expect(tint).toHaveAttribute('data-icon-tint', 'teal')
  // The default stays neutral: no tint on Work's icon.
  await expect(sidebar.viewPill('Work').locator('[data-icon-tint]')).toHaveCount(0)
  // Not selected, it keeps its tint. That it is drawn in the same colour either way is the gallery's.
  await sidebar.filter('All')
  await expect(tint).toHaveAttribute('data-icon-tint', 'teal')
  // The colour is in user.db before the quit.
  await expect.poll(() => storedColor(userData, fake.teamId, 'Bots')).toBe('teal')
  const restarted = await relaunch()
  await expect(restarted.sidebar.viewPill('Bots').locator('[data-icon-tint]')).toHaveAttribute('data-icon-tint', 'teal', { timeout: 15_000 })
  // Edit shows the colour chosen; Neutral takes it off again.
  await restarted.sidebar.viewMenu('Bots', 'view-edit')
  const colours = restarted.sidebar.viewSheet.getByRole('radiogroup', { name: 'Colour' })
  await expect(colours.getByRole('radio', { name: 'Teal', exact: true })).toHaveAttribute('aria-checked', 'true')
  await colours.getByRole('radio', { name: 'Neutral', exact: true }).click()
  await restarted.sidebar.viewSheet.getByRole('button', { name: 'Save' }).click()
  await expect(restarted.sidebar.viewPill('Bots').locator('[data-icon-tint]')).toHaveCount(0)

  await step('a view with no conversations says so, and Edit view opens its sheet', async () => {
    await restarted.sidebar.createView({ name: 'Later' })
    await restarted.sidebar.expectEmpty('No conversations in this view')
    await restarted.sidebar.list.getByRole('button', { name: 'Edit view' }).click()
    await expect(restarted.sidebar.viewSheet).toBeVisible()
    await expect(restarted.sidebar.viewSheet.getByPlaceholder('Name')).toHaveValue('Later')
  })
})

async function iconView({ juno, fake }: Pick<DomContext, 'juno' | 'fake'>): Promise<void> {
  const { sidebar } = juno
  await sidebar.row(ALERTS_MAIN).expectVisible()

  await sidebar.createView({ name: 'Bots', icon: 'Robot', conversations: ['alerts-prod'], keepOutOfAll: true })
  // An icon pill: the name is its tooltip and accessible name, not its text.
  const bots = sidebar.viewPill('Bots')
  await expect(bots).toHaveAttribute('data-tooltip', 'Bots')
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

  // Delete it, so #alerts-prod is back in All and the next step starts with no views.
  await sidebar.viewMenu('Bots', 'view-delete')
  await expect.poll(() => sidebar.viewNames()).toEqual([])
}

async function namedView({ juno }: Pick<DomContext, 'juno'>): Promise<void> {
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
  expect(labels).toContain('(Move left)')
  await expect.poll(() => sidebar.viewNames()).toEqual(['Hiring', 'Eng team'])

  // And back by the menu. Dragging a pill is in views.spec.ts.
  await sidebar.viewMenu('Eng team', 'view-left')
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
}

async function addToView({ juno }: Pick<DomContext, 'juno'>): Promise<void> {
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
}
