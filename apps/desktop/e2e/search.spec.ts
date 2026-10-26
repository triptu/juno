import { searchPage, restoreWindow, navigateMatches, readerWithoutCache, tabAndEdge, foldedMatch, jumpToLatest, topCard } from './searchSteps'
import { expect, test, type Fixtures } from './fixtures'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 180_000 })

const SEARCH = 'search.modules.messages'

/** The rows' ids in order, to see that nothing above moved. */
const rowIds = (page: ReturnType<typeof searchPage>, count: number) => page.rows.evaluateAll((rows, n) => rows.slice(0, n).map((row) => row.getAttribute('data-search-row')), count)

/** Optional screenshots of the real UI for docs/progress/search-tab/ (`JUNO_SEARCH_SHOTS=1`). */
const SHOTS = process.env.JUNO_SEARCH_SHOTS === '1'

/** Screenshots are taken at the mocks' width. */
async function shotSize(juno: Juno): Promise<void> {
  if (SHOTS) await juno.surface.setWindowSize(1440, 900)
}

async function shot(juno: Juno, name: string): Promise<void> {
  if (!SHOTS) return
  await juno.win.waitForTimeout(400)
  await juno.win.screenshot({ path: test.info().outputPath(`${name}.png`) })
}

/** Types `from:` and a name into the field, and picks the person from the picker. */
async function pickFrom(juno: Juno, name: string): Promise<void> {
  const page = searchPage(juno.win)
  await page.field.pressSequentially(`from:${name.slice(0, 3).toLowerCase()}`)
  const picker = juno.win.locator('#search-picker')
  await expect(picker.getByRole('option').first()).toContainText(name)
  await shot(juno, 'picker-light')
  await juno.win.keyboard.press('Enter')
  await expect(page.chips.filter({ hasText: name })).toBeVisible()
}

type Context = Pick<Fixtures, 'juno' | 'slack' | 'fake'>

test('search: from: chip, local cards first, Slack merges below, Space shows the topic and it follows the arrows, it marks read only when used, Esc hides it, Enter and Back; hidden text blurs', async ({ juno, slack, fake }) => {
  const context = { juno, slack, fake }
  await shotSize(juno)
  for (let i = 1; i <= 24; i++) slack.as('Maya').postIn('incidents', `Flamingo note ${i} on the pager`)
  slack.as('Maya').postIn('eng', 'Flamingo rehearsal checklist is ready')
  slack.as('Maya').dm('Flamingo rehearsal notes for you')
  slack.as('Maya').postIn('product', 'Flamingo launch moved to Thursday')
  slack.as('Leo').postIn('product', 'Flamingo from Leo, not from Maya')
  slack.as('Maya').postedLongAgo('platform', 'Flamingo plan from last quarter', 40)
  await juno.sidebar.row('#product').expectVisible()
  await test.step('⌘⇧F opens Search on an empty field that points to ⌘K', () => openEmpty(context))
  await test.step('a from: chip and words show this Mac’s rows at once; Slack’s older row joins below without moving them', () => localThenSlack(context))
  await test.step('↓ from the field selects a card and no topic shows; Space shows it beside the list, it follows the arrows, and nothing is marked read', () => arrowThrough(context))
  await test.step('Tab into the topic’s composer, a reply sent there marks the topic read; Esc goes back to the list, and Esc again hides the topic', () => replyInReader(context))
  await test.step('Enter on another result opens it in this tab; Back returns to the same query, selection, topic and scroll', () => openAndBack(context))
  await test.step('in a narrow window a press shows the topic over the list, and Back to results restores it', async () => {
    const page = searchPage(juno.win)
    // Esc on the card hides the topic first; a narrow window with the topic shown would cover the list at once.
    await page.row('Flamingo note 17 on the pager').focus()
    await juno.win.keyboard.press('Escape')
    await expect(page.reader).toHaveCount(0)
    await juno.surface.setWindowSize(1000, 760)
    await page.row('Flamingo note 17 on the pager').click()
    await expect(page.reader.getByText('Flamingo note 17 on the pager')).toBeVisible()
    await page.reader.getByRole('button', { name: 'Back to results', exact: true }).click()
    await expect(page.row('Flamingo note 17 on the pager')).toBeVisible()
    await juno.surface.setWindowSize(1440, 900)
  })
  if (SHOTS) await test.step('shots: one column and dark', () => moreShots(context))
  // What the Search tab shows and finds is in the DOM lane (`dom/search.test.ts`); the blur is CSS.
  await test.step('with message text hidden, the field, its chips, the cards and the note blur', () => blurred(context))
})

async function moreShots({ juno }: Context): Promise<void> {
  const page = searchPage(juno.win)
  await page.row('Flamingo note 17 on the pager').focus()
  await juno.win.keyboard.press('Escape')
  await juno.surface.setWindowSize(1000, 760)
  // The topic covers the list once its edge is gone; before that Enter would open the topic in this tab.
  await page.row('Flamingo note 17 on the pager').click()
  await expect(page.root.getByRole('separator', { name: 'Resize topic' })).toHaveCount(0)
  await expect(page.reader.getByRole('button', { name: 'Back to results', exact: true })).toBeVisible()
  await shot(juno, 'narrow-light')
  await juno.surface.setWindowSize(1440, 900)
  // Settings opens in the current tab and closes after; a new tab keeps the search.
  await juno.surface.appMenu('new-tab')
  await juno.setTheme('Dark')
  // The search is the first tab: ⌘1 brings it back.
  await juno.surface.appMenu('tab-1')
  await juno.tabs.expectActive('flamingo')
  await shot(juno, 'tab-dark')
  // Esc on the selected card hides the topic: the cards alone.
  await page.row('Flamingo note 17 on the pager').focus()
  await juno.win.keyboard.press('Escape')
  await expect(page.reader).toHaveCount(0)
  await shot(juno, 'cards-dark')
}

async function openEmpty({ juno, fake }: Context): Promise<void> {
  const page = searchPage(juno.win)
  await juno.surface.appMenu('search-messages')
  await juno.tabs.expectActive('Search')
  await expect(page.field).toBeFocused()
  await expect(page.hint).toContainText('To jump to a conversation, topic or command, press')
  await shot(juno, 'empty-light')
  const calls = fake.calls.filter((call) => call.method === SEARCH).length
  await page.field.pressSequentially('f')
  // There is no signal for a call that must not start; sample inside the actual 400 ms pause.
  await juno.win.waitForTimeout(150)
  expect(fake.calls.filter((call) => call.method === SEARCH)).toHaveLength(calls)
  await page.field.pressSequentially('lamingo')
  await expect(page.row('Flamingo launch moved to Thursday')).toBeVisible()
  await expect.poll(() => fake.calls.filter((call) => call.method === SEARCH).length).toBe(calls + 1)
  expect(String(fake.calls.filter((call) => call.method === SEARCH).at(-1)?.args['query'])).toContain('flamingo')
  await page.root.getByRole('button', { name: 'Clear search', exact: true }).click()
}

async function localThenSlack({ juno, fake }: Context): Promise<void> {
  const page = searchPage(juno.win)
  await pickFrom(juno, 'Maya')
  await expect(page.hint).toHaveCount(0)
  // The chip's own search has had Slack's answer, so the hold below catches the words' search.
  await expect(page.row('Flamingo launch moved to Thursday')).toBeVisible()
  await expect(page.results.getByText('Searching Slack…')).toHaveCount(0)
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
  // Nothing is chosen yet, so no topic shows and focus stays in the field.
  await expect(page.rows.and(page.root.locator('[aria-selected="true"]'))).toHaveCount(0)
  await expect(page.reader).toHaveCount(0)
  await expect(page.field).toBeFocused()
  // Each card is the whole message; a run of matches from one topic shows its place line once.
  await expect(page.rows.filter({ hasText: 'on the pager' })).toHaveCount(24)
  await expect(page.places.filter({ hasText: 'incidents' })).toHaveCount(1)
  await shot(juno, 'cards-light')
  await juno.tabs.expectActive('flamingo')
}

async function arrowThrough({ juno, slack }: Context): Promise<void> {
  const { win, sidebar } = juno
  const page = searchPage(win)
  slack.resetCalls()
  await page.field.press('ArrowDown')
  await expect(page.row('Flamingo launch moved to Thursday')).toBeFocused()
  await expect(page.row('Flamingo launch moved to Thursday')).toHaveAttribute('aria-selected', 'true')
  await expect(page.reader).toHaveCount(0)
  await win.keyboard.press('Space')
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
  await expect(page.reader).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(page.reader).toHaveCount(0)
  await expect(page.row('Flamingo rehearsal checklist is ready')).toBeFocused()
  // → shows it again.
  await win.keyboard.press('ArrowRight')
  await expect(page.reader.getByText('Flamingo rehearsal checklist is ready')).toBeVisible()
}

async function openAndBack({ juno }: Context): Promise<void> {
  const { win, tabs, nav } = juno
  const page = searchPage(win)
  const box = await page.results.boundingBox()
  if (box === null) throw new Error('No results column')
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  // Part way down, so Back's restore is not clamped at the list's end.
  await win.mouse.wheel(0, 160)
  await expect.poll(() => page.results.evaluate((list) => list.scrollTop)).toBeGreaterThan(100)
  const target = page.row('Flamingo note 17 on the pager')
  await target.click()
  await expect(target).toHaveAttribute('aria-selected', 'true')
  // The topic beside the list narrows it, so where it is scrolled is read once that has settled.
  await expect(page.reader.getByText('Flamingo note 17 on the pager')).toBeVisible()
  const scrolled = await topCard(page)
  await win.keyboard.press('Enter')
  await tabs.expectActive('incidents')
  await expect(page.root).toHaveCount(0)
  await nav.back()
  await tabs.expectActive('flamingo')
  await expect(page.field).toHaveValue('flamingo')
  await expect(page.chips.filter({ hasText: 'Maya' })).toBeVisible()
  await expect(page.row('Flamingo note 17 on the pager')).toHaveAttribute('aria-selected', 'true')
  await expect(page.reader.getByText('Flamingo note 17 on the pager')).toBeVisible()
  await expect.poll(() => topCard(page)).toBe(scrolled)
}

async function blurred({ juno, slack }: Context): Promise<void> {
  const { palette, tabs, surface, sidebar, win } = juno
  const page = searchPage(win)
  slack.as('Maya').postIn('eng', 'Cormorant budget is approved')
  await sidebar.row('#eng').expectVisible()
  await palette.open()
  await palette.type('from:U0MAYA')
  await surface.appMenu('search-messages')
  await expect(page.chips.filter({ hasText: 'U0MAYA' })).toBeVisible()
  await expect(page.row('Cormorant budget is approved')).toBeVisible()
  await juno.privacy.toggleWithMenu()
  await tabs.expectActive('Search')
  await juno.privacy.expectBlurred(page.field)
  await juno.privacy.expectBlurred(page.chips.locator('[data-sensitive]').first())
  await juno.privacy.expectBlurred(page.row('Cormorant budget is approved').locator('[data-sensitive]').last())
  await page.field.fill('confidential:acquisition')
  const note = page.root.locator('[data-search-note]')
  await expect(note).toContainText('confidential:acquisition')
  await juno.privacy.expectBlurred(note)
}

// Each step searches for its own word, so the cards one step leaves do not match the next.
test('search: Tab from the field lands on a card and the topic’s edge moves with the keys; a long match folds in view and unfolds in place; Jump to latest only while newer messages are out of view', async ({ juno, slack }) => {
  await test.step('Tab from the field lands on a card, Space shows its topic, and the topic’s edge moves with the keys', () => tabAndEdge({ juno, slack }))
  await test.step('a long message folds with its match in view, and Show more unfolds it in place without changing the selection', () => foldedMatch({ juno, slack }))
  await test.step('the topic beside the results shows Jump to latest only while newer messages are out of view', () => jumpToLatest({ juno, slack }))
})

// The restored window needs a relaunch, so it goes last.
test('search: reader navigation applies the whole query beyond the message window; a result not on this Mac shows at once and held arrows load only where they stop; a held Slack answer restores a saved window beyond 200 matches', async ({ juno, slack, fake, relaunch, userData }) => {
  await test.step('reader navigation applies the whole query beyond the message window', () => navigateMatches({ juno, fake }))
  await test.step('a result not on this Mac shows in the reader at once, never the last topic, and held arrows load only where they stop', () => readerWithoutCache({ juno, slack, fake }))
  await test.step('a held Slack answer restores a saved window beyond 200 matches', () => restoreWindow({ juno, fake, relaunch, userData }))
})
