// The Search tab (SPEC 10a): ⌘Enter opens results in tabs behind and focus stays in the list; ⌘F in a
// thread scopes the search to it until Backspace removes its chip; apps and automated channels stay
// hidden until asked for; Slack failing leaves the local rows; ⌘K and ⌘⇧F hand the typed text to the
// Search tab. A restart keeping the tab is in tabs.test.ts.
import { searchPage } from './driver/palette'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

/** Closes every tab, which leaves one Home, as a fresh launch shows it. */
async function freshHome(juno: Juno): Promise<void> {
  const [first] = await juno.tabs.titles()
  await juno.tabs.contextMenu(first!, 'close-all')
  await juno.expectNothingOpen()
}

// One launch: each step searches its own words, from one Home tab.
domTest('search opens results behind, scopes to a thread, hides apps until asked, keeps local rows when Slack fails, and takes text from ⌘K', async ({ juno, slack, fake, step }) => {
  const { surface, tabs, win, sidebar, palette } = juno
  const page = searchPage(win)

  await step('⌘Enter opens results in tabs behind this one and focus stays in the list', async () => {
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
    await freshHome(juno)
  })

  await step('⌘F in a thread searches that thread, and Backspace on its chip widens the search', async () => {
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
    await freshHome(juno)
  })

  await step('apps and automated channels are hidden, and the note shows them', async () => {
    slack.as('Grafana').postIn('alerts-prod', 'zebracrossing latency alert fired')
    slack.as('Grafana').postIn('alerts-prod', 'zebracrossing latency alert resolved')
    slack.as('deploybot').postIn('deploys', 'zebracrossing build 412 deployed')
    slack.as('deploybot').postIn('deploys', 'zebracrossing build 413 deployed')

    await surface.appMenu('search-messages')
    await page.field.pressSequentially('zebracrossing')
    const show = page.results.getByRole('button', { name: 'Show 4 matches' })
    await expect(show).toBeVisible({ timeout: 20_000 })
    await expect(page.rows).toHaveCount(0)
    await show.click()
    await expect(page.rows).toHaveCount(4)
    await expect(page.filter('Apps shown')).toBeVisible()
    await expect(page.filter('Automated shown')).toBeVisible()

    await freshHome(juno)
  })

  await step('when Slack fails the local rows stay with a notice, and Try again recovers', async () => {
    slack.as('Dev').postIn('eng', 'Kiwifruit standup moved to ten')
    slack.as('Dev').postedLongAgo('platform', 'Kiwifruit archive from the spring', 60)
    await sidebar.row('#eng').expectVisible()
    fake.forceError({ method: 'search.modules.messages', error: 'internal_error', times: 100 })

    await surface.appMenu('search-messages')
    await page.field.pressSequentially('kiwifruit')
    const notice = page.results.getByText('Showing matches on this Mac.', { exact: false })
    await expect(notice).toBeVisible({ timeout: 30_000 })
    await expect(page.row('Kiwifruit standup moved to ten')).toBeVisible()
    await expect(page.row('Kiwifruit archive from the spring')).toHaveCount(0)

    fake.clearError({ method: 'search.modules.messages' })
    await page.results.getByRole('button', { name: 'Try again' }).click()
    await expect(page.row('Kiwifruit archive from the spring')).toBeVisible({ timeout: 30_000 })
    await expect(notice).toHaveCount(0)
    await expect(page.row('Kiwifruit standup moved to ten')).toBeVisible()
    await freshHome(juno)
  })

  await step('⌘K’s last row takes the typed text to the Search tab, and so does ⌘⇧F from an open palette', async () => {
    slack.as('Maya').postIn('eng', 'Cormorant budget is approved')
    await sidebar.row('#eng').expectVisible()

    await palette.open()
    await palette.type('cormorant in:C0ENG')
    await palette.expectResults()
    // The first selection stays on a result; the arrows reach the last row as any other.
    expect(await palette.activeText()).not.toMatch(/All results for/)
    await palette.arrowTo(/All results for “cormorant in:C0ENG”/)
    await palette.press('Enter')
    await palette.expectClosed()
    await tabs.expectActive('cormorant')
    await expect(page.field).toHaveValue('cormorant')
    await expect(page.row('Cormorant budget is approved')).toBeVisible()
    await expect(page.chips.filter({ hasText: 'C0ENG' })).toBeVisible()

    await palette.open()
    await palette.type('budget')
    await surface.appMenu('search-messages')
    await palette.expectClosed()
    await tabs.expectActive('budget')
    await expect(page.field).toHaveValue('budget')
    await palette.open()
    await palette.type('from:U0MAYA')
    await surface.appMenu('search-messages')
    await expect(page.field).toHaveValue('')
    await expect(page.chips.filter({ hasText: 'U0MAYA' })).toBeVisible()
    await expect(page.row('Cormorant budget is approved')).toBeVisible()
  })
}, { timeout: 90_000 })
