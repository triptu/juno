import type { Page } from '@playwright/test'
import { expect, test, type Fixtures } from './fixtures'
import { readUserDb } from './driver/userDb'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 150_000 })

const SEARCH = 'search.modules.messages'

/** The Search tab's page (SPEC 10a). */
function searchPage(win: Page) {
  const root = win.locator('[data-search-page]').locator('visible=true')
  const results = root.locator('[data-search-results]')
  return {
    root,
    field: root.locator('input[data-search-field]'),
    chips: root.locator('[data-search-chip]'),
    results,
    rows: results.getByRole('option'),
    row: (text: string) => results.getByRole('option').filter({ hasText: text }),
    reader: root.locator('[data-search-reader]'),
    filter: (name: string) => root.getByRole('toolbar', { name: 'Filters' }).getByRole('button', { name }),
    hint: root.locator('[data-palette-hint]'),
  }
}

/** The rows' ids in order, to see that nothing above moved. */
const rowIds = (page: ReturnType<typeof searchPage>, count: number) => page.rows.evaluateAll((rows, n) => rows.slice(0, n).map((row) => row.getAttribute('data-search-row')), count)

/** Optional screenshots of the real UI for docs/progress/search-tab/ (`JUNO_SEARCH_SHOTS=1`). */
async function shot(juno: Juno, name: string): Promise<void> {
  if (process.env.JUNO_SEARCH_SHOTS !== '1') return
  await juno.win.waitForTimeout(400)
  await juno.win.screenshot({ path: test.info().outputPath(`${name}.png`) })
}

/** Types `from:` and a name into the field, and picks the person from the picker. */
async function pickFrom(juno: Juno, name: string): Promise<void> {
  const page = searchPage(juno.win)
  await page.field.pressSequentially(`from:${name.slice(0, 3).toLowerCase()}`)
  const picker = juno.win.locator('#search-picker')
  await expect(picker.getByRole('option').first()).toContainText(name)
  await juno.win.keyboard.press('Enter')
  await expect(page.chips.filter({ hasText: name })).toBeVisible()
}

type Context = Pick<Fixtures, 'juno' | 'slack' | 'fake'>

test('search: from: chip, local rows first, Slack merges below, the reader follows and marks read only when used, Enter and Back', async ({ juno, slack, fake }) => {
  const context = { juno, slack, fake }
  for (let i = 1; i <= 24; i++) slack.as('Maya').postIn('incidents', `Flamingo note ${i} on the pager`)
  slack.as('Maya').postIn('eng', 'Flamingo rehearsal checklist is ready')
  slack.as('Maya').dm('Flamingo rehearsal notes for you')
  slack.as('Maya').postIn('product', 'Flamingo launch moved to Thursday')
  slack.as('Leo').postIn('product', 'Flamingo from Leo, not from Maya')
  slack.as('Maya').postedLongAgo('platform', 'Flamingo plan from last quarter', 40)
  await juno.sidebar.row('#product').expectVisible()
  await test.step('⌘⇧F opens Search on an empty field that points to ⌘K', () => openEmpty(context))
  await test.step('a from: chip and words show this Mac’s rows at once; Slack’s older row joins below without moving them', () => localThenSlack(context))
  await test.step('↓ from the field and through three results: the reader follows, and nothing is marked read', () => arrowThrough(context))
  await test.step('Tab into the reader’s composer, a reply sent there marks the topic read; Esc goes back to the list', () => replyInReader(context))
  await test.step('Enter on another result opens it in this tab; Back returns to the same query, selection and scroll', () => openAndBack(context))
})

async function openEmpty({ juno }: Context): Promise<void> {
  const page = searchPage(juno.win)
  await juno.surface.appMenu('search-messages')
  await juno.tabs.expectActive('Search')
  await expect(page.field).toBeFocused()
  await expect(page.hint).toContainText('To jump to a conversation, topic or command, press')
  await shot(juno, 'empty-light')
}

async function localThenSlack({ juno, fake }: Context): Promise<void> {
  const page = searchPage(juno.win)
  await pickFrom(juno, 'Maya')
  await expect(page.hint).toHaveCount(0)
  fake.holdNext({ method: SEARCH, reason: 'search' })
  await page.field.pressSequentially('flamingo')
  await expect(page.row('Flamingo launch moved to Thursday')).toBeVisible()
  await expect(page.row('Flamingo from Leo')).toHaveCount(0)
  await expect.poll(() => fake.heldCalls({ method: SEARCH }).some((call) => String(call['query']).includes('flamingo'))).toBe(true)
  await expect(page.results.getByText('Searching Slack…')).toBeVisible()
  await expect(page.row('Flamingo plan from last quarter')).toHaveCount(0)
  const first = await rowIds(page, 6)
  fake.release({ method: SEARCH })
  await expect(page.row('Flamingo plan from last quarter')).toHaveCount(1)
  await expect(page.results.getByText('Searching Slack…')).toHaveCount(0)
  expect(await rowIds(page, 6)).toEqual(first)
  await juno.tabs.expectActive('flamingo')
}

async function arrowThrough({ juno, slack }: Context): Promise<void> {
  const { win, sidebar } = juno
  const page = searchPage(win)
  slack.resetCalls()
  await page.field.press('ArrowDown')
  for (const text of ['Flamingo launch moved to Thursday', 'Flamingo rehearsal notes for you', 'Flamingo rehearsal checklist is ready']) {
    if (text !== 'Flamingo launch moved to Thursday') await win.keyboard.press('ArrowDown')
    await expect(page.row(text)).toBeFocused()
    await expect(page.row(text)).toHaveAttribute('aria-selected', 'true')
    await expect(page.reader.getByText(text)).toBeVisible()
  }
  await shot(juno, 'tab-light')
  await slack.expectNoMarks()
  await expect(sidebar.row('#product').titleText).toHaveCSS('font-weight', '600')
  await expect(sidebar.row('#eng').titleText).toHaveCSS('font-weight', '600')
}

async function replyInReader({ juno, slack, fake }: Context): Promise<void> {
  const { win, sidebar } = juno
  const page = searchPage(win)
  await win.keyboard.press('Tab')
  const composer = page.reader.locator('[data-composer] textarea')
  await expect(composer).toBeFocused()
  await composer.pressSequentially('Thanks, on it')
  await win.keyboard.press('Enter')
  await expect.poll(() => fake.calls.some((call) => call.method === 'chat.postMessage' && String(call.args['text']).includes('Thanks, on it'))).toBe(true)
  await slack.expectMarked('eng')
  await sidebar.row('#eng').expectRead()
  await expect(sidebar.row('#product').titleText).toHaveCSS('font-weight', '600')
  await win.keyboard.press('Escape')
  await expect(page.row('Flamingo rehearsal checklist is ready')).toBeFocused()
}

async function openAndBack({ juno }: Context): Promise<void> {
  const { win, tabs, nav } = juno
  const page = searchPage(win)
  const box = await page.results.boundingBox()
  if (box === null) throw new Error('No results column')
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await win.mouse.wheel(0, 360)
  await expect.poll(() => page.results.evaluate((list) => list.scrollTop)).toBeGreaterThan(200)
  const scrolled = await page.results.evaluate((list) => list.scrollTop)
  const target = page.row('Flamingo note 17 on the pager')
  await target.click()
  await expect(target).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await tabs.expectActive('incidents')
  await expect(page.root).toHaveCount(0)
  await nav.back()
  await tabs.expectActive('flamingo')
  await expect(page.field).toHaveValue('flamingo')
  await expect(page.chips.filter({ hasText: 'Maya' })).toBeVisible()
  await expect(page.row('Flamingo note 17 on the pager')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.results.evaluate((list) => list.scrollTop)).toBe(scrolled)
}

test('search: ⌘Enter opens results in tabs behind this one and focus stays in the list', async ({ juno, slack }) => {
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
  expect(await tabs.titles()).toEqual(expect.arrayContaining([expect.stringMatching(/^design-review/), expect.stringMatching(/^product/)]))
})

test('search: ⌘F in a thread searches that thread, and Backspace on its chip widens the search', async ({ juno, slack }) => {
  const { surface, sidebar, win } = juno
  const page = searchPage(win)
  slack.as('Maya').postIn('eng', 'Osprey rollout plan for the storage tier')
  slack.as('Leo').replyIn('Osprey rollout plan', 'osprey canary looks healthy')
  slack.as('Sam').postIn('product', 'osprey pricing page copy')
  await sidebar.row('Osprey rollout plan').open()

  await surface.appMenu('search-topic')
  await expect(page.chips.filter({ hasText: 'Osprey rollout plan' })).toBeVisible()
  await page.field.pressSequentially('osprey')
  await expect(page.row('osprey canary looks healthy')).toBeVisible()
  await expect(page.row('Osprey rollout plan for the storage tier')).toBeVisible()
  await expect(page.row('osprey pricing page copy')).toHaveCount(0)
  await shot(juno, 'scoped-light')

  await page.field.press('Home')
  await page.field.press('Backspace')
  await expect(page.chips).toHaveCount(0)
  await expect(page.row('osprey pricing page copy')).toBeVisible()
})

test('search: apps and automated channels are hidden; the note shows them, and the toggles are remembered', async ({ juno, slack }) => {
  const { surface, tabs, win } = juno
  const page = searchPage(win)
  slack.as('Grafana').postIn('alerts-prod', 'zebracrossing latency alert fired')
  slack.as('Grafana').postIn('alerts-prod', 'zebracrossing latency alert resolved')
  slack.as('deploybot').postIn('deploys', 'zebracrossing build 412 deployed')
  slack.as('deploybot').postIn('deploys', 'zebracrossing build 413 deployed')

  await surface.appMenu('search-messages')
  await page.field.pressSequentially('zebracrossing')
  await expect(page.results.getByText('4 matches, all from apps and automated channels.')).toBeVisible({ timeout: 20_000 })
  await expect(page.rows).toHaveCount(0)
  await shot(juno, 'states-only-hidden-light')
  await page.results.getByRole('button', { name: 'Show 4 matches' }).click()
  await expect(page.rows).toHaveCount(4)
  await expect(page.filter('Apps shown')).toBeVisible()
  await expect(page.filter('Automated shown')).toBeVisible()

  await surface.appMenu('close-tab')
  await expect(tabs.tab('zebracrossing')).toHaveCount(0)
  await surface.appMenu('search-messages')
  await expect(page.filter('Apps shown')).toBeVisible()
  await expect(page.filter('Automated shown')).toBeVisible()
  await page.field.pressSequentially('zebracrossing')
  await expect(page.rows).toHaveCount(4)
})

test('search: when Slack fails the local rows stay with a notice, and Try again recovers', async ({ juno, slack, fake }) => {
  const { surface, win, sidebar } = juno
  const page = searchPage(win)
  slack.as('Dev').postIn('eng', 'Kiwifruit standup moved to ten')
  slack.as('Dev').postedLongAgo('platform', 'Kiwifruit archive from the spring', 60)
  await sidebar.row('#eng').expectVisible()
  fake.forceError({ method: SEARCH, error: 'internal_error', times: 100 })

  await surface.appMenu('search-messages')
  await page.field.pressSequentially('kiwifruit')
  await expect(page.results.getByText("Showing matches on this Mac. Slack search didn't answer.")).toBeVisible({ timeout: 30_000 })
  await expect(page.row('Kiwifruit standup moved to ten')).toBeVisible()
  await expect(page.row('Kiwifruit archive from the spring')).toHaveCount(0)
  await shot(juno, 'states-unavailable-light')

  fake.clearError({ method: SEARCH })
  await page.results.getByRole('button', { name: 'Try again' }).click()
  await expect(page.row('Kiwifruit archive from the spring')).toBeVisible({ timeout: 30_000 })
  await expect(page.results.getByText("Showing matches on this Mac. Slack search didn't answer.")).toHaveCount(0)
  await expect(page.row('Kiwifruit standup moved to ten')).toBeVisible()
})

test('search: a restart brings the Search tab back with its query and selection, grouped by thread as it was left', async ({ juno, slack, fake, relaunch, userData }) => {
  const { surface, win, sidebar } = juno
  const page = searchPage(win)
  slack.as('Maya').postIn('eng', 'Pelican migration plan for the queue')
  for (const step of ['one', 'two', 'three']) slack.as('Leo').replyIn('Pelican migration plan', `pelican step ${step} is done`)
  await sidebar.row('Pelican migration plan').expectVisible()

  await surface.appMenu('search-messages')
  await page.field.pressSequentially('pelican')
  // Flat by default: one row per match, newest first.
  await expect(page.rows).toHaveCount(4)
  await expect(page.results.getByText(/more in this thread/)).toHaveCount(0)
  await page.row('pelican step two is done').click()
  await expect(page.reader.getByText('pelican step two is done')).toBeVisible()

  await page.filter('Group by thread').click()
  await expect(page.filter('Group by thread')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.results.getByText('2 more in this thread')).toBeVisible()
  await expect(page.row('pelican step two is done')).toHaveAttribute('aria-selected', 'true')
  await shot(juno, 'grouped-light')

  // The session and the preference have reached the engine.
  const pref = (key: string) => readUserDb(userData, fake.teamId, (db) => (db.prepare(`SELECT value_json FROM prefs WHERE key = ?`).get(key) as { value_json: string } | undefined)?.value_json ?? '')
  await expect.poll(() => pref('tabs')).toMatch(/"search":\{"text":"pelican".*"selected":/)
  await expect.poll(() => pref('search')).toContain('"groupByThread":true')

  const restarted = await relaunch()
  const again = searchPage(restarted.win)
  await restarted.tabs.expectActive('pelican')
  await expect(again.field).toHaveValue('pelican')
  await expect(again.filter('Group by thread')).toHaveAttribute('aria-pressed', 'true')
  await expect(again.results.getByText('2 more in this thread')).toBeVisible()
  await expect(again.row('pelican step two is done')).toHaveAttribute('aria-selected', 'true')
  await expect(again.reader.getByText('pelican step two is done')).toBeVisible()
})
