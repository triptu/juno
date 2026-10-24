/**
 * A DM huddle while Slack's edge lags its socket. `huddles/info` answers
 * from a moment ago (the spike saw it list a user as active after the room
 * frame said they had left), so a read sent just after a room frame can
 * say the huddle has nobody in it. The call must still show who is in it,
 * count up from its start and keep its row's headphones.
 */
import { expect, syncedTest as test } from './fixtures'
import { addRemote, connection } from './huddleFake'

test.describe.configure({ timeout: 90_000 })

test('a DM huddle shows both people and counts up while huddles/info lags the room frames', async ({ juno, fake, win }) => {
  fake.control('setHuddleInfoLag', { ms: 1_500 })
  const row = juno.sidebar.row('Maya', { exact: true })
  await row.open()
  await juno.sidebar.leave()
  await juno.topic.header.getByRole('button', { name: 'Start huddle' }).click()
  const bar = win.getByRole('region', { name: 'Huddle', exact: true })
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')

  // Maya answers soon after, while Slack's edge still lists the huddle as it was before.
  fake.control('joinHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
  await addRemote(win, 'U0MAYA')
  // Mount the tab between the bar's ticks: independently mounted clocks used to disagree.
  await expect(bar).toContainText(/0:0[1-4]/)
  await bar.getByRole('button', { name: 'Open huddle in Maya' }).click()
  await juno.tabs.expectActive('Maya · Huddle')

  const tiles = win.getByRole('list', { name: 'People in the huddle' }).getByRole('listitem')
  await expect(tiles).toHaveCount(2)
  await expect(tiles.nth(0)).toHaveAccessibleName('You')
  await expect(tiles.nth(1)).toHaveAccessibleName('Maya')
  const page = win.locator('[data-huddle-page]')
  await expect(page).not.toContainText("You're the only one here")
  await expect(win.locator('[data-huddle-bar] button [role="img"]')).toHaveAccessibleName('Maya')
  // The huddle has run for more than five seconds, and the line counts on.
  await expect(bar).toContainText(/0:(0[5-9]|[1-5]\d)/, { timeout: 10_000 })
  await expect(bar).not.toContainText('0:00')
  await expect(row.root.locator('[data-huddle-indicator]')).toBeVisible()
  const durations = await win.evaluate(async () => {
    const samples: Array<ReadonlyArray<string | null>> = []
    for (let i = 0; i < 100; i++) {
      samples.push(['[data-huddle-bar]', '[data-huddle-page]'].map((selector) =>
        document.querySelector(selector)?.textContent?.match(/\d+:\d{2}/)?.[0] ?? null))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return samples
  })
  expect(durations.filter(([barTime, tabTime]) => barTime === null || barTime !== tabTime)).toEqual([])
  expect(new Set(durations.map(([time]) => time)).size).toBeGreaterThan(1)
})
