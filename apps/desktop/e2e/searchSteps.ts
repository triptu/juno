import type { Page } from '@playwright/test'
import { expect, test, type Fixtures } from './fixtures'
import { SEARCH_WINDOW } from '@juno/contract'
import { readUserDb } from './driver/userDb'
const SEARCH = 'search.modules.messages'

/** Optional screenshots of the real UI for docs/progress/search-tab/ (`JUNO_SEARCH_SHOTS=1`), as in search.spec.ts. */
async function shot(win: Page, name: string): Promise<void> {
  if (process.env.JUNO_SEARCH_SHOTS !== '1') return
  await win.waitForTimeout(400)
  await win.screenshot({ path: test.info().outputPath(`${name}.png`) })
}

/** The Search tab's page (SPEC 10a). */
export function searchPage(win: Page) {
  const root = win.locator('[data-search-page]').locator('visible=true')
  const results = root.locator('[data-search-results]')
  return {
    root,
    field: root.locator('input[data-search-field]'),
    chips: root.locator('[data-search-chip]'),
    results,
    // The cards the arrows stop on; the older line is a disabled option.
    rows: results.locator('[data-search-row]'),
    row: (text: string) => results.locator('[data-search-row]').filter({ hasText: text }),
    // The place lines over the cards: one for a run of cards from one topic.
    places: results.locator('[data-search-place]'),
    // The topic beside the results, once asked for.
    reader: root.locator('[data-search-reader]'),
    filter: (name: string) => root.getByRole('toolbar', { name: 'Filters' }).getByRole('button', { name }),
    hint: root.locator('[data-palette-hint]'),
  }
}

/** The card at the top of the results' view and how far its top is from the list's, as the session keeps it. */
export function topCard(page: ReturnType<typeof searchPage>): Promise<string> {
  return page.results.evaluate((list) => {
    const top = list.getBoundingClientRect().top
    for (const row of list.querySelectorAll<HTMLElement>('[data-search-row]')) {
      const box = row.getBoundingClientRect()
      if (box.bottom > top) return `${row.dataset.searchRow} ${Math.round(box.top - top)}`
    }
    return ''
  })
}

export async function restoreWindow({ juno, fake, relaunch, userData }: Pick<Fixtures, 'juno' | 'fake' | 'relaunch' | 'userData'>) {
  const now = fake.now()
  // Each older than the last post, which takes the fake clock's now: two posts at one time can preview either.
  for (let i = 0; i < 280; i++) fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `restorationprobe message ${i}`, at: now - (i + 1) * 1000 })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'restorationprobe ready' })
  await expect(juno.sidebar.row('#eng').preview).toContainText('restorationprobe ready')
  const page = searchPage(juno.win)
  await juno.surface.appMenu('search-messages')
  await page.field.fill('restorationprobe')
  await expect(page.rows).toHaveCount(SEARCH_WINDOW)
  const saved = () => readUserDb(userData, fake.teamId, (db) => (db.prepare("SELECT value_json FROM prefs WHERE key = 'tabs'").get() as { value_json: string } | undefined)?.value_json ?? '')
  // Each move at the end takes the window on by half of it: to 200 in eight.
  for (let i = 0; i < 8; i++) {
    const before = await page.rows.first().getAttribute('data-search-row')
    await page.results.evaluate((list) => { list.scrollTop = list.scrollHeight })
    await expect.poll(() => page.rows.first().getAttribute('data-search-row')).not.toBe(before)
  }
  // Stop between the sentinels and wait for scrollend persistence before restarting.
  await page.results.evaluate((list) => { list.scrollTop = 700 })
  await expect.poll(saved).toMatch(/"offset":(?:175|200)/)
  const first = await page.rows.first().getAttribute('data-search-row')
  const top = await topCard(page)
  const [id, offset] = top.split(' ')
  await expect.poll(saved).toContain(`"scrolled":{"id":"${id}","top":${offset}}`)
  fake.holdNext({ method: SEARCH, reason: 'search' })
  const restarted = await relaunch()
  const again = searchPage(restarted.win)
  await expect.poll(() => fake.heldCount({ method: SEARCH })).toBe(1)
  fake.release({ method: SEARCH })
  await expect(again.rows.first()).toHaveAttribute('data-search-row', first!)
  await expect.poll(() => topCard(again)).toBe(top)
}

export async function navigateMatches({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>) {
  const now = fake.now()
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'Long navigation topic', at: now - 700_000 })
  const matches: string[] = []
  for (let i = 0; i < 650; i++) {
    const match = i === 5 || i === 640
    const row = fake.workspace.post({ channel: 'C0ENG', user: i === 320 ? 'U0GRAFANA' : 'U0MAYA', text: `navigationprobe entry ${i}`, threadTs: root.ts, at: now - (650 - i) * 1000,
      ...(match || i === 320 ? { files: [{ id: `FSEARCH${i}`, name: 'plan.txt', title: 'Plan', mimetype: 'text/plain', filetype: 'text', size: 1 }] } : {}) })
    if (match) matches.push(row.ts)
  }
  const page = searchPage(juno.win)
  await juno.surface.appMenu('search-messages')
  await page.field.fill('navigationprobe has:file ')
  await expect(page.rows).toHaveCount(2)
  await page.row('navigationprobe entry 640').click()
  await expect(page.reader.locator('[data-match-count]')).toHaveText('2 of 2')
  await page.reader.getByRole('button', { name: 'Previous match (2 of 2)' }).click()
  await expect(page.reader.locator(`[data-message-row="${matches[0]}"]`)).toBeVisible()
  await expect(page.reader.locator('[data-match-count]')).toHaveText('1 of 2')
  await page.reader.getByRole('button', { name: 'Next match (1 of 2)' }).click()
  await expect(page.reader.locator(`[data-message-row="${matches[1]}"]`)).toBeVisible()
  await expect(page.reader.locator('[data-match-count]')).toHaveText('2 of 2')
}

export async function tabAndEdge({ juno, slack }: Pick<Fixtures, 'juno' | 'slack'>) {
  const { surface, sidebar, win } = juno
  const page = searchPage(win)
  slack.as('Leo').postIn('eng', 'Heron migration is done')
  slack.as('Sam').postIn('product', 'Heron dashboards are live')
  await sidebar.row('#product').expectVisible()

  await surface.appMenu('search-messages')
  await page.field.pressSequentially('heron')
  await expect(page.rows).toHaveCount(2)
  await page.row('Heron migration is done').click()
  await expect(page.reader.getByText('Heron migration is done')).toBeVisible()
  // The chosen card is not among the next query's: the selection and its topic go, and Tab lands on the first card and selects it.
  await page.field.fill('heron dashboards')
  await expect(page.rows).toHaveCount(1)
  const row = page.row('Heron dashboards are live')
  await expect(row).toHaveAttribute('aria-selected', 'false')
  await expect(page.reader).toHaveCount(0)
  for (let i = 0; i < 20 && !(await row.evaluate((element) => element === document.activeElement)); i++) await win.keyboard.press('Tab')
  await expect(row).toBeFocused()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Space')
  await expect(page.reader.getByText('Heron dashboards are live')).toBeVisible()

  // The topic's left edge: ← widens it, as a drag to the left does. The window has room for it to grow.
  await juno.surface.setWindowSize(1440, 900)
  const edge = page.root.getByRole('separator', { name: 'Resize topic' })
  const panel = page.root.locator('[data-search-panel]')
  const width = () => panel.evaluate((element) => Math.round(element.getBoundingClientRect().width))
  const start = await width()
  await edge.focus()
  await win.keyboard.press('ArrowLeft')
  await expect.poll(width).toBeGreaterThan(start)
  await win.keyboard.press('End')
  await expect(edge).toHaveAttribute('aria-valuenow', (await edge.getAttribute('aria-valuemax'))!)
  await win.keyboard.press('Home')
  await expect(edge).toHaveAttribute('aria-valuenow', (await edge.getAttribute('aria-valuemin'))!)
  await win.keyboard.press('Enter')
  await expect.poll(width).toBe(start)
}

/** Where a card's first match sits inside its folded message, and whether it shows there. */
async function matchInView(page: ReturnType<typeof searchPage>, text: string, word: string): Promise<boolean> {
  return page.row(text).locator('[data-search-body]').evaluate((body, word) => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = (node.textContent ?? '').toLowerCase().indexOf(word)
      if (at < 0) continue
      const range = new Range()
      range.setStart(node, at)
      range.setEnd(node, at + word.length)
      const box = body.getBoundingClientRect()
      const mark = range.getBoundingClientRect()
      return mark.height > 0 && mark.top >= box.top && mark.bottom <= box.bottom
    }
    return false
  }, word)
}

/**
 * A long message whose match is near its end: folded, its match still shows; Show more unfolds it whole, in place,
 * and leaves the selection on the card that had it. Space and Enter on a focused Show more fold and unfold it.
 */
export async function foldedMatch({ juno, slack }: Pick<Fixtures, 'juno' | 'slack'>) {
  const { surface, sidebar, win } = juno
  const page = searchPage(win)
  const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of the launch notes, about the rollout order and who signs off on each step.`)
  slack.as('Elena').postIn('product', [...lines, 'The gannet pilot starts on Thursday with the billing team.'].join('\n'))
  slack.as('Leo').postIn('product', 'Gannet pilot budget is approved')
  await sidebar.row('#product').expectVisible()

  if (process.env.JUNO_SEARCH_SHOTS === '1') await surface.setWindowSize(1440, 900)
  await surface.appMenu('search-messages')
  await page.field.pressSequentially('gannet')
  const card = page.row('Line 1 of the launch notes')
  await expect(card).toBeVisible()
  // ↓ from the field selects the newest card; no topic shows.
  const selected = page.row('Gannet pilot budget is approved')
  await win.keyboard.press('ArrowDown')
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  const body = card.locator('[data-search-body]')
  await expect(body).toHaveAttribute('data-folded', '')
  await expect.poll(() => matchInView(page, 'Line 1 of the launch notes', 'gannet')).toBe(true)
  // The search mark is on the word, from the card's own highlight.
  await expect.poll(() => win.evaluate(() => CSS.highlights.get('search-card')?.size ?? 0)).toBeGreaterThan(0)

  await shot(win, 'card-folded-light')
  const top = await card.evaluate((element) => Math.round(element.getBoundingClientRect().top))
  await card.getByRole('button', { name: 'Show more' }).click()
  await expect(body).not.toHaveAttribute('data-folded', '')
  await expect(card.getByRole('button', { name: 'Show less' })).toBeVisible()
  await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
  await expect.poll(() => matchInView(page, 'Line 1 of the launch notes', 'gannet')).toBe(true)
  // Unfolding grows the card downward; the card itself stays where it was, and no topic opened.
  expect(await card.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(top)
  await expect(page.reader).toHaveCount(0)
  // The press did not move focus into the card, so the selection stayed where it was.
  await expect(selected).toHaveAttribute('aria-selected', 'true')
  await expect(card).toHaveAttribute('aria-selected', 'false')
  await shot(win, 'card-unfolded-light')

  // With Show less focused, Space and Enter are the button's, not the list's: they fold and unfold, and no topic shows.
  await card.locator('[data-search-more]').focus()
  await win.keyboard.press('Space')
  await expect(body).toHaveAttribute('data-folded', '')
  await win.keyboard.press('Enter')
  await expect(body).not.toHaveAttribute('data-folded', '')
  await expect(page.reader).toHaveCount(0)
}

/** The topic beside the results opens at the match; Jump to latest shows only while newer messages are out of view, as in a topic tab. */
export async function jumpToLatest({ juno, slack }: Pick<Fixtures, 'juno' | 'slack'>) {
  const page = searchPage(juno.win)
  slack.as('Leo').postIn('eng', 'Kestrel cutover plan for Friday')
  slack.as('Maya').replyIn('Kestrel cutover plan', 'Kestrel cutover moved to Monday')
  slack.as('Leo').replyIn('Kestrel cutover plan', 'Monday works for the billing team')
  slack.as('Maya').postIn('product', 'Plover review notes')
  slack.as('Leo').replyIn('Plover review notes', 'Plover review starts with billing')
  for (let i = 1; i <= 40; i++) slack.as(i % 2 === 0 ? 'Maya' : 'Leo').replyIn('Plover review notes', `Follow-up ${i} on the review order`)
  await juno.sidebar.row('#product').expectVisible()
  await juno.surface.appMenu('search-messages')
  const jump = page.reader.getByRole('button', { name: 'Jump to latest' })

  // A short thread opens at its match with its newest reply in view: nothing newer to jump to.
  await page.field.pressSequentially('kestrel monday')
  await page.row('Kestrel cutover moved to Monday').click()
  await expect(page.reader.getByText('Monday works for the billing team')).toBeVisible()
  await expect(page.reader.getByText('Kestrel cutover moved to Monday')).toBeVisible()
  await expect(jump).toHaveCount(0)

  // A long one opens at its match with forty replies below it: the pill brings the newest.
  await page.field.fill('plover billing')
  await page.row('Plover review starts with billing').click()
  await expect(page.reader.getByText('Plover review starts with billing')).toBeVisible()
  await expect(jump).toBeVisible()
  await jump.click()
  await expect(page.reader.getByText('Follow-up 40 on the review order')).toBeVisible()
  await expect(jump).toHaveCount(0)
}

const HISTORY = 'conversations.history'

/** What the reader painted while `target` was the selected row, frame by frame: whether `stale` was in it, and where `ts`'s message was. */
async function watchReader(win: Page, target: string, stale: string, ts: string): Promise<void> {
  await win.evaluate(({ target, stale, ts }) => {
    const seen = { stale: false, tops: [] as number[] }
    const hold = window as unknown as { readerFrames?: typeof seen }
    hold.readerFrames = seen
    const frame = () => {
      if (hold.readerFrames !== seen) return
      const reader = document.querySelector('[data-search-reader]')
      const selected = document.querySelector('[data-search-row][aria-selected="true"]')
      if (reader !== null && selected?.textContent?.includes(target) === true) {
        if (reader.textContent?.includes(stale) === true) seen.stale = true
        const row = reader.querySelector(`[data-message-row="${CSS.escape(ts)}"]`)
        if (row !== null) seen.tops.push(Math.round(row.getBoundingClientRect().top))
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, { target, stale, ts })
}

async function readerFrames(win: Page): Promise<{ readonly stale: boolean; readonly tops: ReadonlyArray<number> }> {
  return win.evaluate(() => {
    const hold = window as unknown as { readerFrames?: { stale: boolean; tops: number[] } }
    const seen = hold.readerFrames
    delete hold.readerFrames
    return seen ?? { stale: true, tops: [] }
  })
}

/**
 * A result whose topic is not on this Mac shows in the reader at once, header and message, never with the last
 * topic's messages, and its topic fills in around the message without moving it. Arrows held through results
 * load only the one they stop on.
 */
export async function readerWithoutCache({ juno, slack, fake }: Pick<Fixtures, 'juno' | 'slack' | 'fake'>) {
  const { win, surface, sidebar } = juno
  const page = searchPage(win)
  slack.as('Maya').postIn('product', 'Osprey launch moved to Thursday')
  // Only Slack's search finds these, newest first, each in its own channel's Main.
  const places = ['eng', 'platform', 'incidents', 'design-review', 'hiring']
  const old = places.map((place, index) => ({ place, text: `Osprey archive note in ${place}`, ts: slack.as('Maya').postedLongAgo(place, `Osprey archive note in ${place}`, 30 + index) }))
  await sidebar.row('#product').expectVisible()
  await surface.appMenu('search-messages')
  await page.field.pressSequentially('osprey')
  await expect(page.rows).toHaveCount(6)
  // A press on the newest result, on this Mac, shows its topic beside the list.
  await page.row('Osprey launch moved to Thursday').click()
  await expect(page.reader.getByText('Osprey launch moved to Thursday')).toBeVisible()
  await expect(page.reader.locator('[data-composer] textarea')).toBeVisible()

  const platform = old[1]!
  fake.holdNext({ method: HISTORY, reason: 'open', times: 20 })
  await watchReader(win, platform.text, 'Osprey launch moved to Thursday', platform.ts)
  await page.row(platform.text).click()
  await expect(page.reader.locator('[data-topic-header]')).toContainText('platform')
  await expect(page.reader.getByText(platform.text)).toBeVisible()
  await expect.poll(() => fake.heldCalls({ method: HISTORY }).some((call) => call['channel'] === slack.channel('platform'))).toBe(true)
  // Slack has not answered, and the reader shows the result, not the last topic.
  await expect(page.reader.getByText('Osprey launch moved to Thursday')).toHaveCount(0)
  fake.release({ method: HISTORY })
  await expect(page.reader.locator('[data-composer] textarea')).toBeVisible()
  await expect(page.reader.locator(`[data-message-row="${platform.ts}"]`)).toBeVisible()
  await win.waitForTimeout(300)
  const frames = await readerFrames(win)
  expect(frames.stale).toBe(false)
  expect(frames.tops.length).toBeGreaterThan(0)
  expect(new Set(frames.tops).size, `the message's top over ${frames.tops.length} frames: ${frames.tops.join(', ')}`).toBe(1)

  // From the first row, five results down in one go, as a held arrow repeats: only where it stops asks Slack.
  await page.row('Osprey launch moved to Thursday').click()
  await expect(page.reader.locator('[data-composer] textarea')).toBeVisible()
  const from = fake.calls.length
  fake.holdNext({ method: HISTORY, reason: 'open', times: 20 })
  await page.row('Osprey launch moved to Thursday').focus()
  await win.evaluate(() => {
    for (let i = 0; i < 5; i++) document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  })
  const last = old[4]!
  await expect(page.row(last.text)).toBeFocused()
  await expect(page.reader.locator('[data-topic-header]')).toContainText(last.place)
  await expect(page.reader.getByText(last.text)).toBeVisible()
  await expect.poll(() => fake.heldCount({ method: HISTORY })).toBe(1)
  // There is no signal for a load that must not start; give a stray one time to arrive.
  await win.waitForTimeout(300)
  // The fake records a call once it answers: the held ones are the loads in flight.
  const passed = new Set(places.map((place) => slack.channel(place)))
  const answered = fake.calls.slice(from).filter((call) => call.method === HISTORY && call.args['_x_reason'] === 'open').map((call) => String(call.args['channel']))
  const held = fake.heldCalls({ method: HISTORY }).map((args) => String(args['channel']))
  expect([...answered, ...held].filter((channel) => passed.has(channel))).toEqual([slack.channel(last.place)])
  fake.release({ method: HISTORY })
  await expect(page.reader.locator('[data-composer] textarea')).toBeVisible()
  await expect(page.reader.locator(`[data-message-row="${last.ts}"]`)).toBeVisible()
}
