import { expect, test } from './fixtures'
import { absolute, budget } from './perfBaseline'
import { stats } from './perfStats'

test.skip(process.env.JUNO_PERF !== '1', 'set JUNO_PERF=1 to measure')

/** The cached topic budget (performance.md 1): the reader follows an arrow from the store. */
const READER_BUDGET = 50
/** ⌘K's keystroke budget, which the Search field shares (performance.md 1). */
const RESULTS_BUDGET = 100

if (absolute) test('search: arrow to reader and keystroke to results', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const channels = ['eng', 'product', 'platform', 'incidents', 'design-review']
  for (let i = 0; i < 30; i++) slack.as(i % 2 === 0 ? 'Maya' : 'Leo').postIn(channels[i % channels.length]!, `Albatross check ${i} for the perf run`)
  await juno.sidebar.row('#design-review').expectVisible()

  const page = juno.win.locator('[data-search-page]').locator('visible=true')
  const field = page.locator('input[data-search-field]')
  const rows = page.locator('[data-search-results] [data-search-row]')
  await juno.surface.appMenu('search-messages')
  await field.pressSequentially('albatross', { delay: 60 })
  await expect(rows).toHaveCount(30)
  const resultSamples = await juno.measures('juno.search-results')
  // Deferred renders fold fast keys into one.
  expect(resultSamples.length).toBeGreaterThanOrEqual(7)
  budget(stats('search keystroke to rows painted', resultSamples.slice(2)), RESULTS_BUDGET)

  for (let i = 0; i < 20; i++) {
    await juno.win.keyboard.press('ArrowDown')
    await expect(rows.nth(i)).toBeFocused()
    // An arrow only selects until Space (or → or a click) shows the topic beside the results; after that, each arrow moves it.
    if (i === 0) await juno.win.keyboard.press('Space')
    // The reader shows the match before the next press, as a reader would look.
    const id = await rows.nth(i).getAttribute('data-search-row')
    expect(id).not.toBeNull()
    const ts = id!.slice(id!.indexOf(':') + 1)
    await expect(page.locator(`[data-search-reader] [data-message-row="${ts}"]`)).toBeVisible()
    await expect.poll(async () => (await juno.measures('juno.search-reader')).length).toBe(i + 1)
    // A reader's pause before the next arrow, so the neighbour's prefetch has landed: pressed at once, one
    // arrow in 17 found it still loading and painted the stand-in (laptop, 10-26).
    await juno.win.waitForTimeout(150)
  }
  // The first moves warm the neighbours; the rest read from a warm cache.
  const readerSamples = await juno.measures('juno.search-reader')
  expect(readerSamples).toHaveLength(20)
  // Each sample says what the reader painted: the topic itself, or the result's own message while the topic was not local.
  const painted = await juno.win.evaluate(() =>
    performance.getEntriesByName('juno.search-reader', 'measure').map((entry) => {
      const properties: ReadonlyArray<readonly [string, unknown]> = (entry as unknown as { detail?: { devtools?: { properties?: Array<[string, unknown]> } } }).detail?.devtools?.properties ?? []
      return properties.find(([key]) => key === 'reader')?.[1]
    }),
  )
  // The next row was warm before each warm arrow, so the topic painted, not the stand-in.
  expect(painted.slice(3)).toEqual(Array.from({ length: 17 }, () => 'topic'))
  budget(stats('search arrow to reader painted', readerSamples.slice(3)), READER_BUDGET)
})
