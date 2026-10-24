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
    rows: results.getByRole('option'),
    row: (text: string) => results.getByRole('option').filter({ hasText: text }),
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
