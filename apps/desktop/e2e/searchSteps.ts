import type { Page } from '@playwright/test'
import { expect, type Fixtures } from './fixtures'
import { readUserDb } from './driver/userDb'
const SEARCH = 'search.modules.messages'

/** The Search tab's page (SPEC 10a). */
export function searchPage(win: Page) {
  const root = win.locator('[data-search-page]').locator('visible=true')
  const results = root.locator('[data-search-results]')
  return {
    root,
    field: root.locator('input[data-search-field]'),
    chips: root.locator('[data-search-chip]'),
    results,
    // The rows the arrows stop on; the Main header and the older line are disabled options.
    rows: results.locator('[data-search-row]'),
    row: (text: string) => results.locator('[data-search-row]').filter({ hasText: text }),
    reader: root.locator('[data-search-reader]'),
    filter: (name: string) => root.getByRole('toolbar', { name: 'Filters' }).getByRole('button', { name }),
    hint: root.locator('[data-palette-hint]'),
  }
}

export async function restoreWindow({ juno, fake, relaunch, userData }: Pick<Fixtures, 'juno' | 'fake' | 'relaunch' | 'userData'>) {
  const now = fake.now()
  for (let i = 0; i < 280; i++) fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `restorationprobe message ${i}`, at: now - i * 1000 })
  fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'restorationprobe ready' })
  await expect(juno.sidebar.row('#eng').preview).toContainText('restorationprobe ready')
  const page = searchPage(juno.win)
  await juno.surface.appMenu('search-messages')
  await page.field.fill('restorationprobe')
  await expect(page.rows).toHaveCount(100)
  const saved = () => readUserDb(userData, fake.teamId, (db) => (db.prepare("SELECT value_json FROM prefs WHERE key = 'tabs'").get() as { value_json: string } | undefined)?.value_json ?? '')
  for (let i = 0; i < 4; i++) {
    const before = await page.rows.first().getAttribute('data-search-row')
    await page.results.evaluate((list) => { list.scrollTop = list.scrollHeight })
    await expect.poll(() => page.rows.first().getAttribute('data-search-row')).not.toBe(before)
  }
  // Stop between the sentinels and wait for scrollend persistence before restarting.
  await page.results.evaluate((list) => { list.scrollTop = 700 })
  await expect.poll(saved).toMatch(/"offset":(?:150|200)/)
  const first = await page.rows.first().getAttribute('data-search-row')
  const top = await page.results.evaluate((list) => list.scrollTop)
  await expect.poll(saved).toContain(`"scrollTop":${top}`)
  fake.holdNext({ method: SEARCH, reason: 'search' })
  const restarted = await relaunch()
  const again = searchPage(restarted.win)
  await expect.poll(() => fake.heldCount({ method: SEARCH })).toBe(1)
  fake.release({ method: SEARCH })
  await expect(again.rows.first()).toHaveAttribute('data-search-row', first!)
  await expect.poll(() => again.results.evaluate((list) => list.scrollTop)).toBe(top)
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


export async function profileDates({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>) {
  const self = fake.workspace.users.get(fake.workspace.selfId)!
  const user = { ...self, tz: 'America/Los_Angeles' }
  fake.workspace.users.set(user.id, user)
  fake.emitFrame({ type: 'user_change', user })
  const browser = await juno.win.context().newCDPSession(juno.win)
  await browser.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kolkata' })
  // Kolkata is already on Oct 25; the Slack profile is still on Oct 24.
  await juno.win.clock.setFixedTime(new Date('2026-10-24T19:00:00Z'))
  expect(await juno.win.evaluate(() => new Date().getDate())).toBe(25)
  fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: 'calendarprobe today', at: Date.parse('2026-10-24T12:00:00Z') })
  const page = searchPage(juno.win)
  await juno.surface.appMenu('search-messages')
  await page.field.fill('calendarprobe')
  await expect(page.row('calendarprobe today')).toBeVisible()
  await juno.surface.chooseNextMenuItem('date:today', false)
  await page.filter('Date').click()
  await expect(page.chips.filter({ hasText: 'Today' })).toBeVisible()
  await expect.poll(() => fake.calls.filter((call) => call.method === SEARCH).some((call) => String(call.args['query']).includes('on:2026-10-24'))).toBe(true)
  await expect(page.row('calendarprobe today')).toBeVisible()
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
  // The chosen row is not among the next query's rows: Tab lands on the first row, selects it, and the reader follows.
  await page.field.fill('heron dashboards')
  await expect(page.rows).toHaveCount(1)
  const row = page.row('Heron dashboards are live')
  await expect(row).toHaveAttribute('aria-selected', 'false')
  for (let i = 0; i < 20 && !(await row.evaluate((element) => element === document.activeElement)); i++) await win.keyboard.press('Tab')
  await expect(row).toBeFocused()
  await expect(row).toHaveAttribute('aria-selected', 'true')
  await expect(page.reader.getByText('Heron dashboards are live')).toBeVisible()

  const edge = page.root.getByRole('separator', { name: 'Resize results' })
  const column = page.root.locator('[data-search-column]')
  const width = () => column.evaluate((element) => Math.round(element.getBoundingClientRect().width))
  const start = await width()
  // Tab from a row goes on to the reader's composer; the edge comes after the rows.
  await edge.focus()
  await win.keyboard.press('ArrowRight')
  await expect.poll(width).toBeGreaterThan(start)
  await win.keyboard.press('End')
  await expect(edge).toHaveAttribute('aria-valuenow', (await edge.getAttribute('aria-valuemax'))!)
  await win.keyboard.press('Home')
  await expect(edge).toHaveAttribute('aria-valuenow', (await edge.getAttribute('aria-valuemin'))!)
  await win.keyboard.press('Enter')
  await expect.poll(width).toBe(start)
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
  const places = ['eng', 'platform', 'incidents', 'design-review', 'sales']
  const old = places.map((place, index) => ({ place, text: `Osprey archive note in ${place}`, ts: slack.as('Leo').postedLongAgo(place, `Osprey archive note in ${place}`, 30 + index) }))
  await sidebar.row('#product').expectVisible()
  await surface.appMenu('search-messages')
  await page.field.pressSequentially('osprey')
  await expect(page.rows).toHaveCount(6)
  // Slack has answered: the newest result, on this Mac, shows as the peek.
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
  const passed = new Set(places.map((place) => slack.channel(place)))
  const loads = fake.calls.slice(from).filter((call) => call.method === HISTORY && call.args['_x_reason'] === 'open' && passed.has(String(call.args['channel'])))
  expect(loads.map((call) => call.args['channel'])).toEqual([slack.channel(last.place)])
  fake.release({ method: HISTORY })
  await expect(page.reader.locator('[data-composer] textarea')).toBeVisible()
  await expect(page.reader.locator(`[data-message-row="${last.ts}"]`)).toBeVisible()
}
