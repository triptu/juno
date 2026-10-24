/**
 * Notification hours from the owner's side (SPEC 14): days and times set
 * in Settings › Notifications hold a message outside them, a day with its
 * own hours reaches Slack's schedule as custom days and decides by those
 * hours, and hours saved by an older version still load. Hours becoming
 * active is covered by the TestClock flow in
 * packages/engine/test/flows/notifications.flow.test.ts.
 */
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, syncedTest } from './fixtures'
import type { Juno } from './driver/juno'
import { readUserDb } from './driver/userDb'
import { test as agentTest } from './juno-agent/chat'
import { agentReady } from './juno-agent/agent'

const standingByTest = agentTest.extend({ synced: true })

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Read the saved settings: a select's DOM value changes before its RPC commits. */
function savedSettings(userData: string, teamId: string): unknown {
  return readUserDb(userData, teamId, (db) => {
    const row = db.prepare("SELECT value_json FROM prefs WHERE key = 'notifications'").get()
    return typeof row?.value_json === 'string' ? JSON.parse(row.value_json) : undefined
  })
}

type ReadSettings = () => unknown

/** Include both sides of midnight, even when the test starts on a weekend. */
async function everyDay(juno: Juno, saved: ReadSettings): Promise<void> {
  for (const [day, name] of weekdays.entries()) {
    const toggle = juno.notifications.day('Notifications', name)
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click()
    await expect.poll(saved).toMatchObject({ notificationHours: { days: expect.arrayContaining([day]) } })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  }
}

/** Set one edge of the notification hours and check it saved. */
async function setHours(juno: Juno, saved: ReadSettings, edge: 'from' | 'to', minutes: number): Promise<void> {
  const select = juno.notifications.root.getByRole('combobox', { name: `Notifications ${edge}` })
  await select.selectOption(String(minutes))
  await expect.poll(saved).toMatchObject({ notificationHours: { [edge]: minutes } })
  // Reopen to check the saved value, rather than the select's optimistic DOM value.
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await expect(select).toHaveValue(String(minutes))
}

/** A twelve-hour window that starts six hours from now, so now is outside it. */
async function excludeNow(juno: Juno, saved: ReadSettings): Promise<void> {
  await everyDay(juno, saved)
  const middle = Math.floor(minutesNow() / 30) * 30
  await setHours(juno, saved, 'from', (middle + 6 * 60) % 1440)
  await setHours(juno, saved, 'to', (middle + 18 * 60) % 1440)
}

const minutesNow = () => {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

standingByTest('outside notification hours a DM is held with its reason and shows no notification', async ({ juno, slack, model, userData, fake }) => {
  await agentReady(juno.surface)
  await juno.openNotifications()
  const page = juno.notifications
  const saturday = page.day('Notifications', 'Saturday')
  const sunday = page.day('Notifications', 'Sunday')
  await expect(saturday).toHaveAttribute('aria-pressed', 'false')
  await expect(sunday).toHaveAttribute('aria-pressed', 'false')
  // Both events use the same saved model, before either command can update the page.
  await saturday.or(sunday).evaluateAll((nodes) => {
    for (const node of nodes) if (node instanceof HTMLButtonElement) node.click()
  })
  await juno.tabs.close('Settings')
  await juno.openNotifications()
  await expect(saturday).toHaveAttribute('aria-pressed', 'true')
  await expect(sunday).toHaveAttribute('aria-pressed', 'true')
  await expect(page.day('Active in Slack', 'Saturday')).toHaveAttribute('aria-pressed', 'false')
  await juno.openNotifications()
  await excludeNow(juno, () => savedSettings(userData, fake.teamId))
  await juno.blurWindow()
  const held = 'Can you approve the release now?'
  slack.as('Maya').dm(held)
  await expect.poll(() => readUserDb(userData, fake.teamId, (db) => db.prepare('SELECT outcome, reason FROM notification_log WHERE preview = ?').get(held))).toMatchObject({ outcome: 'stay', reason: expect.stringContaining('Outside your notification hours.') })
  expect(await juno.osNotifications()).toHaveLength(0)
  expect(model.inputs()).toHaveLength(0)
})

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

syncedTest('hours saved by an older version still load; a day with its own hours reaches Slack as a custom schedule and decides by those hours', async ({ fake, slack, userData, relaunch }) => {
  // As an older version saved them: one set of days and one from and to.
  const juno = await relaunch({ whileClosed: () => {
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
    const old = { notificationHours: { days: [1, 2, 3, 4, 5], from: 600, to: 1020 }, presenceHours: { days: [1, 2, 3, 4, 5], from: 540, to: 1140 }, channels: {}, people: {} }
    db.prepare('INSERT INTO prefs (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json').run('notifications', JSON.stringify(old))
    db.close()
  } })
  await expect(juno.home.navItem).toBeVisible({ timeout: 30_000 })
  await juno.openNotifications()
  const page = juno.notifications
  await expect(page.day('Notifications', 'Monday')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.day('Notifications', 'Saturday')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.root.getByRole('combobox', { name: 'Notifications from' })).toHaveValue('600')
  await expect(page.root.getByRole('combobox', { name: 'Notifications to' })).toHaveValue('1020')

  await juno.sidebar.row('#product').chooseInMenu('notify-always')
  await juno.expectToast('#product: Always')
  // Every day around now; then today gets its own hours, and yesterday none, so no span from yesterday reaches now.
  await juno.notificationHoursNow()
  const saved = () => savedSettings(userData, fake.teamId) as { notificationHours: { from: number; to: number; days: number[]; dayHours?: unknown } }
  const shared = saved().notificationHours
  const today = await juno.win.evaluate(() => new Date().getDay())
  const yesterday = (today + 6) % 7
  const tomorrow = (today + 1) % 7
  const half = Math.floor(minutesNow() / 30) * 30
  const [from, to] = [(half + 360) % 1440, (half + 1080) % 1440]
  await page.root.getByRole('button', { name: 'Different hours on some days' }).click()
  const select = (day: number, edge: 'from' | 'to') => page.root.getByRole('combobox', { name: `${weekdays[day]} ${edge}` })
  await select(yesterday, 'from').selectOption('off')
  await select(today, 'from').selectOption(String(from))
  await select(today, 'to').selectOption(String(to))
  await expect.poll(saved).toMatchObject({ notificationHours: { dayHours: [{ day: today, from, to }] } })
  expect(saved().notificationHours.days).not.toContain(yesterday)

  // Slack holds the same hours: today its own, tomorrow the shared ones, yesterday none.
  const dayName = (day: number) => weekdays[day]!.toLowerCase()
  await expect.poll(() => fake.workspace.prefs).toMatchObject({
    dnd_days: 'custom',
    [`dnd_enabled_${dayName(yesterday)}`]: 'all_day',
    [`dnd_enabled_${dayName(today)}`]: 'partial',
    [`dnd_before_${dayName(today)}`]: clock(from),
    [`dnd_after_${dayName(today)}`]: from < to ? clock(to) : '23:59',
    [`dnd_before_${dayName(tomorrow)}`]: clock(shared.from),
  })

  // Now is inside the shared hours but outside today's own.
  const held = 'Roadmap review moved to next week'
  slack.as('Leo').postIn('product', held)
  await expect.poll(() => readUserDb(userData, fake.teamId, (db) => db.prepare('SELECT outcome, reason FROM notification_log WHERE preview = ?').get(held)), { timeout: 15_000 })
    .toMatchObject({ outcome: 'stay', reason: expect.stringContaining('Outside your notification hours.') })

  // Today's own hours moved to take in now: the next message notifies.
  await select(today, 'from').selectOption(String(half))
  await select(today, 'to').selectOption(String((half + 120) % 1440))
  await expect.poll(saved).toMatchObject({ notificationHours: { dayHours: [{ day: today, from: half, to: (half + 120) % 1440 }] } })
  const shown = 'Pricing review moved to 3pm'
  slack.as('Leo').postIn('product', shown)
  await expect.poll(async () => (await juno.osNotifications()).map((each) => each.body), { timeout: 15_000 }).toContain(shown)
  expect((await juno.osNotifications()).map((each) => each.body)).not.toContain(held)
})
