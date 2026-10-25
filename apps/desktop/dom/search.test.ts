// The Search tab (SPEC 10a): ⌘Enter opens results in tabs behind and focus stays in the
// list; ⌘F in a thread scopes the search to it until Backspace removes its chip.
import { searchPage } from './driver/palette'
import { expect } from './expect'
import { domTest } from './test'

domTest('search: ⌘Enter opens results in tabs behind this one and focus stays in the list', async ({ juno, slack }) => {
  const { surface, tabs, win, sidebar } = juno
  const page = searchPage(win)
  slack.as('Leo').postIn('eng', 'Heron migration is done')
  slack.as('Sam').postIn('product', 'Heron dashboards are live')
  slack.as('Priya').postIn('design-review', 'Heron mockups are ready')
  await sidebar.row('#design-review').expectVisible()

  await surface.appMenu('search-messages')
  await page.field.pressSequentially('heron')
  await expect(page.rows).toHaveCount(3)
  await page.field.press('ArrowDown')
  await expect(page.row('Heron mockups are ready')).toBeFocused()
  await win.keyboard.press('Meta+Enter')
  await tabs.expectCount(2)
  await tabs.expectActive('heron')
  await win.keyboard.press('ArrowDown')
  await win.keyboard.press('Meta+Enter')
  await tabs.expectCount(3)
  await tabs.expectActive('heron')
  await expect(page.row('Heron dashboards are live')).toBeFocused()
  await expect.poll(() => tabs.titles()).toEqual(expect.arrayContaining([expect.stringMatching(/^design-review/), expect.stringMatching(/^product/)]))
})

domTest('search: ⌘F in a thread searches that thread, and Backspace on its chip widens the search', async ({ juno, slack }) => {
  const { surface, sidebar, win } = juno
  const page = searchPage(win)
  // Your own thread, so it is in the sidebar to open.
  slack.as('Tushar').postIn('eng', 'Osprey rollout plan for the storage tier')
  slack.as('Leo').replyIn('Osprey rollout plan', 'osprey canary looks healthy')
  slack.as('Sam').postIn('product', 'osprey pricing page copy')
  await sidebar.row('Osprey rollout plan').open()
  await juno.topic.expectTitle('Osprey rollout plan')

  await surface.appMenu('search-topic')
  await expect(page.chips.filter({ hasText: 'Osprey rollout plan' })).toBeVisible()
  await page.field.pressSequentially('osprey')
  await expect(page.row('osprey canary looks healthy')).toBeVisible()
  await expect(page.row('Osprey rollout plan for the storage tier')).toBeVisible()
  await expect(page.row('osprey pricing page copy')).toHaveCount(0)

  await page.field.press('Home')
  await page.field.press('Backspace')
  await expect(page.chips).toHaveCount(0)
  await expect(page.row('osprey pricing page copy')).toBeVisible()
})
