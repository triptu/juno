import { expect, test } from './fixtures'
import { stats } from './perfStats'

test.skip(process.env.JUNO_PERF !== '1', 'set JUNO_PERF=1 to measure')

/** The cached topic budget (performance.md 1): the reader follows an arrow from the store. */
const READER_BUDGET = 50
/** ⌘K's keystroke budget, which the Search field shares (performance.md 1). */
const RESULTS_BUDGET = 100

test('search: arrow to reader and keystroke to results', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const channels = ['eng', 'product', 'platform', 'incidents', 'design-review']
  for (let i = 0; i < 30; i++) slack.as(i % 2 === 0 ? 'Maya' : 'Leo').postIn(channels[i % channels.length]!, `Albatross check ${i} for the perf run`)
  await juno.sidebar.row('#design-review').expectVisible()

  const page = juno.win.locator('[data-search-page]').locator('visible=true')
  const field = page.locator('input[data-search-field]')
  const rows = page.locator('[data-search-results]').getByRole('option')
  await juno.surface.appMenu('search-messages')
  await field.pressSequentially('albatross', { delay: 60 })
  await expect(rows).toHaveCount(30)
  const results = stats('search keystroke to rows painted', (await juno.measures('juno.search-results')).slice(2))
  expect.soft(results.p95, `keystroke to rows p95 ${results.p95.toFixed(1)} ms`).toBeLessThanOrEqual(RESULTS_BUDGET)

  await field.press('ArrowDown')
  await expect(rows.first()).toBeFocused()
  for (let i = 1; i < 20; i++) {
    await juno.win.keyboard.press('ArrowDown')
    await expect(rows.nth(i)).toBeFocused()
    // The reader shows the match before the next press, as a reader would look.
    await expect(page.locator('[data-search-reader] [data-topic-view]')).toBeVisible()
  }
  // The first moves warm the neighbours; the rest read from a warm cache.
  const reader = stats('search arrow to reader painted', (await juno.measures('juno.search-reader')).slice(3))
  expect.soft(reader.p95, `arrow to reader p95 ${reader.p95.toFixed(1)} ms`).toBeLessThanOrEqual(READER_BUDGET)
})
