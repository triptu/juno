// Pause notifications (SPEC 14): Slack's own snooze from the avatar menu's submenu, which keeps Juno's OS
// notifications quiet until it ends, and a colleague's pause shown on their dot until it ends. The clock moves past
// each end.
import { expect } from './expect'
import { domTest } from './test'

domTest('Pause notifications for 1 hour from the keyboard snoozes Slack and holds every notification until the snooze ends; a colleague’s pause shows on their dot until it ends, and again when their DM is shown later', async ({ juno, fake, slack, clock, step }) => {
  const button = juno.sidebar.accountButton
  const account = juno.accountMenu.root.getByRole('menu', { name: 'Account' })
  const choices = juno.accountMenu.root.getByRole('menu', { name: 'Pause notifications' })
  const press = (key: string) => juno.win.keyboard.press(key)
  const bodies = async () => (await juno.osNotifications()).map((shown) => shown.body)
  // Hours six hours either side of now, so the jumps never leave them; #eng on Always, so a message there notifies.
  await juno.notificationHoursNow({ wide: true })
  // The hours reach Slack's schedule once the first catch-up ends; wait for it, so its write does not land in a later step.
  await expect.poll(() => fake.calls.some((call) => call.method === 'users.prefs.set'), { timeout: 10_000 }).toBe(true)
  await juno.sidebar.row('#eng').chooseInMenu('notify-always')
  await juno.expectToast('#eng: Always')
  // The sidebar's dots on: the recent DMs' partners stay followed while their DMs are not shown.
  await juno.openSettings('Appearance')
  await juno.settings.sidebarPresence.check()
  await expect(juno.settings.sidebarPresence).toBeChecked()
  await juno.tabs.close('Settings')

  await step('the avatar menu opened with Enter takes ↓ at once; → opens the choices beside it, Escape closes only them, and Enter on 1 hour asks Slack for a 60 minute snooze', async () => {
    await expect(button.locator('[data-paused]')).toHaveCount(0)
    await button.press('Enter')
    await expect(account).toBeFocused()
    // Your status, away, hide message text, notification settings, then Pause notifications.
    for (let row = 0; row < 5; row++) await press('ArrowDown')
    await expect(account).toHaveAttribute('aria-activedescendant', 'account-pause')
    await press('ArrowRight')
    await expect(choices).toBeFocused()
    await expect(choices).toHaveAttribute('aria-activedescendant', 'account-pause-30m')

    await press('Escape')
    await expect(choices).toHaveCount(0)
    await expect(juno.accountMenu.root).toBeVisible()
    await expect(account).toBeFocused()
    await expect(account).toHaveAttribute('aria-activedescendant', 'account-pause')

    await press('Enter')
    await expect(choices).toHaveAttribute('aria-activedescendant', 'account-pause-30m')
    await press('ArrowDown')
    await press('Enter')
    await expect.poll(() => fake.calls.filter((call) => call.method === 'dnd.setSnooze').map((call) => call.args['num_minutes'])).toEqual(['60'])
    await expect(juno.accountMenu.root).toHaveCount(0)
    await expect(button.locator('[data-paused]')).toHaveCount(1)
  })

  await step('while snoozed, Resume says until when and Notification settings does not; a Resume Slack refuses keeps the pause and says so', async () => {
    await juno.accountMenu.open()
    await expect(juno.accountMenu.item(/^Resume notifications/)).toContainText('Paused until')
    await expect(juno.accountMenu.item(/^Notification settings/)).not.toContainText('Paused until')
    fake.forceError({ method: 'dnd.endSnooze', error: 'restricted_action', times: 1 })
    await juno.accountMenu.choose(/^Resume notifications/)
    await juno.expectToast("Couldn't resume notifications. Try again.")
    await expect(button.locator('[data-paused]')).toHaveCount(1)
    await juno.accountMenu.open()
    await expect(juno.accountMenu.item(/^Resume notifications/)).toBeVisible()
    await juno.accountMenu.close()
  })

  await step('a message while paused stays in Juno with no OS notification; when the snooze, shortened in another Slack client, ends, its end timer lifts it on time and the next message notifies', async () => {
    await juno.openNotifications()
    const today = juno.notifications.root.getByText(/stayed in Juno/)
    const stayed = () => Number(/(\d+) stayed in Juno/.exec(today.allTextContents().join(' '))?.[1] ?? Number.NaN)
    await expect(today).toBeVisible()
    const before = stayed()
    slack.as('Leo').postIn('eng', 'Deploy finished while you were paused')
    await expect.poll(stayed).toBe(before + 1)

    // Shortened to end in two seconds: Slack sends `dnd_updated`, and Juno reads the new end, so Resume's line
    // changes. Time then runs on its own, with no jump: no reconnect reads the snooze again, and neither the status's
    // minute rerun nor a presence change comes in two seconds, so only the end timer can lift the pause.
    await juno.accountMenu.open()
    const resume = juno.accountMenu.item(/^Resume notifications/)
    const hourLine = resume.allTextContents().join('')
    fake.workspace.setSnooze(Math.floor(fake.workspace.clock.now() / 1000) + 2)
    await expect(resume).not.toHaveText(hourLine)
    await juno.accountMenu.close()
    await expect(button.locator('[data-paused]')).toHaveCount(0)
    slack.as('Leo').postIn('eng', 'Second deploy is out')
    await expect.poll(bodies, { timeout: 15_000 }).toContain('Second deploy is out')
    expect(await bodies()).not.toContain('Deploy finished while you were paused')
  })

  const maya = juno.sidebar.row('Maya', { exact: true })
  const dot = juno.topic.contextPill.locator('[data-pill-presence]')
  const askedAboutMaya = () => fake.calls.filter((call) => call.method === 'dnd.teamInfo' && (call.args['users'] ?? '').split(',').includes('U0MAYA')).length

  await step('a colleague who pauses gets the snooze badge on their dot, and the end timer clears it when their pause ends', async () => {
    await juno.tabs.close('Settings')
    await maya.open()
    await juno.topic.expectTitle('Maya')
    await expect(dot).toHaveCount(1)
    await expect(dot.locator('[data-paused]')).toHaveCount(0)
    const now = Math.floor(fake.workspace.clock.now() / 1000)
    // The first ask fails; it is tried again shortly, so the badge still comes.
    const tries = askedAboutMaya()
    fake.forceError({ method: 'dnd.teamInfo', error: 'restricted_action', times: 1 })
    fake.workspace.setUserDnd('U0MAYA', { next_dnd_start_ts: now - 60, next_dnd_end_ts: now + 3_600 })
    await expect(dot.locator('[data-paused]')).toHaveCount(1)
    expect(askedAboutMaya()).toBe(tries + 2)
    await expect(juno.topic.contextPill).toHaveAccessibleName(/notifications paused\. Show in sidebar\.$/)

    // Maya cuts it to end in two seconds. Time runs on its own, with no jump, so nothing but the end timer
    // recomputes who is paused: no reconnect and no presence change.
    const asked = askedAboutMaya()
    fake.workspace.setUserDnd('U0MAYA', { next_dnd_start_ts: now - 60, next_dnd_end_ts: Math.floor(fake.workspace.clock.now() / 1000) + 2 })
    await expect.poll(askedAboutMaya).toBe(asked + 1)
    await expect(dot.locator('[data-paused]')).toHaveCount(0)
    // Slack names only the next scheduled pause, so its end asks again; that answer is the last before the next step.
    await expect.poll(askedAboutMaya).toBe(asked + 2)
  })

  await step('a pause Slack sent no event for shows when Maya’s DM is shown again after the last answer went stale', async () => {
    // With the sidebar's dots on, Maya stays followed while her DM is not shown, so only a fresh ask can find her pause.
    await juno.sidebar.row('#eng').open()
    await juno.topic.expectTitle('eng')
    const now = Math.floor(fake.workspace.clock.now() / 1000)
    fake.workspace.dnd.set('U0MAYA', { next_dnd_start_ts: now - 60, next_dnd_end_ts: now + 3_600 })
    // Past the fast test timing's 15 s staleness and under the socket's 30 s pong timeout, so no reconnect asks.
    await clock.fastForward(16_000)
    fake.workspace.clock.advance(16_000)
    await maya.open()
    await juno.topic.expectTitle('Maya')
    await expect(dot.locator('[data-paused]')).toHaveCount(1)
  })
}, { clock: true })
