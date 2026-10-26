/**
 * Huddles (SPEC 20) as the user meets them, against the fake Slack on
 * `huddles_arch_v2`. Under JUNO_E2E the page runs the fake media session
 * (`@juno/huddle-media/fake`), which the test drives through
 * `window.__junoHuddleMedia`; no test talks to Chime. On v2 Slack learns of a
 * leave from Chime, so the test tells the fake when the page's media stopped
 * (`stopMedia`), as Chime would. An incoming huddle (SPEC 20, "Incoming
 * huddles") shows its card at the top of the sidebar, rings and posts a
 * notification; the ring is recorded, not played, under JUNO_E2E. Screen
 * shares and main's Huddle menu and quit dialog stay in `e2e/huddle.spec.ts`.
 */
import { TEAM } from '@juno/fake-slack'
import { expect } from './expect'
import { addRemote, attendee, chimeDrops, connection, endMedia, localMuted, played, ringing, rings, startHuddleFromMenu } from './huddle'
import { domTest, type DomContext } from './test'

// One launch: each part ends the huddles it leaves running, so the next starts from none.
domTest('start, mute, leave and join huddles; an incoming huddle rings, joins, dismisses and goes; a DM huddle counts up while huddles/info lags', async ({ juno, fake, step }) => {
  const { win } = juno
  await step('start a huddle from the topic menu, mute from the bar, open the tab and leave', () => startAndLeave({ juno, fake }))
  await step('join a running huddle, and Join here after joining on another device', () => joinAgain({ juno, fake }))
  fake.control('endHuddle', { channel: 'C0ENG' })
  await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toHaveCount(0)

  await step('someone starts a huddle: the card rings, Join joins, Dismiss hides it, and it goes when the huddle ends', async () => {
    fake.resetCalls()
    await juno.notificationHoursNow()
    await juno.sidebar.row('#eng').chooseInMenu('notify-always')
    await juno.expectToast('#eng: Always')
    await juno.sidebar.row('Maya', { exact: true }).chooseInMenu('notify-always')
    await juno.expectToast('Maya: Always')
    await juno.sidebar.row('#product').chooseInMenu('notify-never')
    await juno.expectToast('#product: Never')

    // Maya starts a huddle in #eng: the card shows at once, pulses and rings, and macOS shows a silent notification.
    fake.control('startHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
    const card = win.getByRole('region', { name: 'Incoming huddle' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Open huddle in #eng' })).toBeVisible()
    await expect(card).toContainText('Maya started a huddle')
    await expect(card.locator('[data-pulse]')).toHaveCount(1)
    await expect.poll(() => ringing(win)).toBe(true)
    await expect.poll(() => juno.osNotifications()).toContainEqual({ title: '#eng', body: 'Maya started a huddle', silent: true })

    // Join: the card and the ring go, and the bar shows the call.
    await card.getByRole('button', { name: 'Join the huddle in #eng' }).click()
    const bar = win.getByRole('region', { name: 'Huddle', exact: true })
    await expect(bar).toBeVisible()
    await expect(card).toBeHidden()
    await expect.poll(() => ringing(win)).toBe(false)
    // The bar shows while the join is on its way to Slack.
    await expect.poll(() => fake.calls.filter((call) => call.method === 'rooms.join').map((call) => call.args['channel_id'])).toEqual(['C0ENG'])
    await expect.poll(() => connection(win)).toBe('connected')

    // While in a call, Maya's DM huddle shows its card under the bar with Switch, and does not ring.
    const before = await rings(win)
    fake.control('startHuddle', { channel: 'D0MAYA', user: 'U0MAYA' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: 'Switch to the huddle in Maya' })).toBeVisible()
    await expect(card).toContainText('Started a huddle')
    expect(await rings(win)).toBe(before)
    expect(await ringing(win)).toBe(false)
    await expect.poll(() => juno.osNotifications()).toContainEqual({ title: 'Maya', body: 'Started a huddle', silent: true })

    // Dismiss hides it; the huddle goes on, and the DM's row still shows it running.
    await card.getByRole('button', { name: 'Dismiss' }).click()
    await expect(card).toBeHidden()
    await expect(juno.sidebar.row('Maya', { exact: true }).root.locator('[data-huddle-indicator]')).toBeVisible()

    // Leave the call. A huddle in a channel set to Never shows its card quietly: no pulse, no ring, no notification, and no bounce even with Juno in the background.
    const attendeeId = await attendee(win)
    await bar.getByRole('button', { name: 'Leave' }).click()
    await expect(bar).toBeHidden()
    await chimeDrops(win, fake, attendeeId!)
    const shown = (await juno.osNotifications()).length
    await juno.setFrontmost(false)
    fake.control('startHuddle', { channel: 'C0PRODUCT', user: 'U0LEO' })
    await expect(card.getByRole('button', { name: 'Open huddle in #product' })).toBeVisible()
    await expect(card).toContainText('Leo started a huddle')
    await expect(card.locator('[data-pulse]')).toHaveCount(0)
    expect(await ringing(win)).toBe(false)
    expect(await juno.dockBounces()).toBe(0)

    // The huddle ends: the card goes.
    fake.control('endHuddle', { channel: 'C0PRODUCT' })
    await expect(card).toBeHidden()
    expect((await juno.osNotifications()).length).toBe(shown)

    // The notification opens Juno at the huddle: its tab, where the user can join.
    const eng = (await juno.osNotifications()).findIndex((notification) => notification.title === '#eng')
    await juno.clickOsNotification(eng)
    await juno.tabs.expectActive('eng · Huddle')
    await expect(win.getByRole('button', { name: 'Join huddle' })).toBeVisible()
  })
  await juno.setFrontmost(true)
  fake.control('endHuddle', { channel: 'C0ENG' })
  fake.control('endHuddle', { channel: 'D0MAYA' })
  await expect(juno.sidebar.row('Maya', { exact: true }).root.locator('[data-huddle-indicator]')).toHaveCount(0)

  // huddles/info answers from a moment ago (the spike saw it list a user as active after the room frame said they
  // had left), so a read sent just after a room frame can say the huddle has nobody in it.
  await step('a DM huddle shows both people and counts up while huddles/info lags the room frames', async () => {
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
    // The huddle has run past twice the edge's lag, and the line counts on.
    await expect(bar).toContainText(/0:(0[3-9]|[1-5]\d)/, { timeout: 10_000 })
    await expect(bar).not.toContainText('0:00')
    await expect(row.root.locator('[data-huddle-indicator]')).toBeVisible()
    // Sampled every 20 ms until the clock has ticked once, at most 2 s.
    const durations: Array<ReadonlyArray<string | null>> = []
    for (let i = 0; i < 100; i++) {
      durations.push(['[data-huddle-bar]', '[data-huddle-page]'].map((selector) => win.document.querySelector(selector)?.textContent?.match(/\d+:\d{2}/)?.[0] ?? null))
      if (new Set(durations.map(([time]) => time)).size > 1) break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(durations.filter(([barTime, tabTime]) => barTime === null || barTime !== tabTime)).toEqual([])
    expect(new Set(durations.map(([time]) => time)).size).toBeGreaterThan(1)
  })
}, { timeout: 150_000, tag: ['@heavy', '@heavy-huddle'] })

type Context = Pick<DomContext, 'juno' | 'fake'>

const barOf = (juno: Context['juno']) => juno.win.getByRole('region', { name: 'Huddle', exact: true })

async function startAndLeave({ juno, fake }: Context): Promise<void> {
  const { win } = juno
  const bar = barOf(juno)
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await juno.sidebar.leave()
  // A DM's header has Start huddle; a channel's has it in its menus only.
  await juno.sidebar.row('Maya', { exact: true }).open()
  await expect(juno.topic.header.getByRole('button', { name: 'Start huddle' })).toBeVisible()
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await juno.sidebar.leave()
  await expect(juno.topic.header.getByRole('button', { name: 'Start huddle' })).toHaveCount(0)
  await startHuddleFromMenu(juno)

  // The bar shows at once, under the title bar, and the call connects.
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Open huddle in #eng' })).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  const joined = fake.calls.filter((call) => call.method === 'rooms.join')
  expect(joined).toHaveLength(1)
  expect(joined[0]?.args).toMatchObject({ channel_id: 'C0ENG', regions: 'us-east-1', _x_reason: 'calls-api/joinRoom' })
  await expect(win.getByRole('button', { name: /^In huddle/ })).toBeVisible()
  // The join sound plays once the call connects, and the bar is live once the engine has it.
  await expect.poll(() => played(win)).toEqual(['join'])
  await expect(bar).not.toContainText('Joining…')
  // The row shows the huddle running in its channel.
  await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toBeVisible()

  // Mute from the bar, then with the shortcut.
  const mute = bar.getByRole('button', { name: /^Mute/ })
  await mute.click()
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  expect(await localMuted(win)).toBe(true)
  await win.keyboard.press('Meta+Shift+Space')
  await expect(mute).toHaveAttribute('aria-pressed', 'false')

  // Someone joins: the bar shows them, and the join sound plays.
  fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0MAYA' })
  await addRemote(win, 'U0MAYA')
  await expect(bar.locator('img, [data-avatar]').first()).toBeAttached()
  await expect.poll(() => played(win)).toEqual(['join', 'join'])

  // Someone the store has never seen joins: Juno asks Slack who they are, and the bar names them.
  fake.workspace.addUser({ id: 'U0RINSATO', team_id: TEAM.id, name: 'rin', real_name: 'Rin Sato', profile: { display_name: 'Rin Sato', real_name: 'Rin Sato' } })
  fake.control('joinHuddle', { channel: 'C0ENG', user: 'U0RINSATO' })
  await addRemote(win, 'U0RINSATO')
  await expect(bar.getByRole('img', { name: /Rin Sato/ })).toBeVisible()

  // The bar's first row opens the huddle tab.
  await bar.getByRole('button', { name: 'Open huddle in #eng' }).click()
  await juno.tabs.expectActive('eng · Huddle')
  await expect(win.locator('[data-huddle-page]').getByRole('group', { name: 'Huddle controls' })).toBeVisible()

  // Leave: the bar goes at once and the leave goes to Slack as the official client sends it.
  const attendeeId = await attendee(win)
  expect(attendeeId).not.toBeNull()
  await bar.getByRole('button', { name: 'Leave' }).click()
  await expect(bar).toBeHidden()
  await expect.poll(() => fake.calls.filter((call) => call.method === 'rooms.leave').length).toBe(1)
  expect(fake.calls.find((call) => call.method === 'rooms.leave')?.args).toMatchObject({ channel_id: 'C0ENG', attendee_id: attendeeId, reason: 'user_initiated' })
  await chimeDrops(win, fake, attendeeId!)
  // Two joins (Maya, then Rin), then the user's own leave.
  await expect.poll(() => played(win)).toEqual(['join', 'join', 'join', 'leave'])
  // The tab stays, and shows the huddle without the user: Maya is still in it.
  await expect(win.getByRole('button', { name: 'Join huddle' })).toBeVisible({ timeout: 15_000 })
}

async function joinAgain({ juno, fake }: Context): Promise<void> {
  const { win } = juno
  const bar = barOf(juno)
  // Maya and Rin are still in it. The header's Join; the sidebar's incoming card has its own (huddle-incoming.spec.ts).
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  await juno.sidebar.leave()
  const join = juno.topic.header.getByRole('button', { name: /^Join/ })
  await expect(join).toBeVisible({ timeout: 15_000 })
  await expect(juno.sidebar.row('#eng').root.locator('[data-huddle-indicator]')).toBeVisible()
  const joinsBefore = fake.calls.filter((call) => call.method === 'rooms.join').length
  await join.click()
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  const first = await attendee(win)

  // The user joins the same huddle from their phone: Chime moves them there.
  await endMedia(win, 'another-device')
  await expect(bar).toBeHidden()
  await juno.expectToast('You joined this huddle on another device')
  fake.control('stopMedia', { attendeeId: first! })

  // Join here joins again, with a new attendee.
  await juno.toast('You joined this huddle on another device').getByRole('button', { name: 'Join here' }).click()
  await expect(bar).toBeVisible()
  await expect.poll(() => connection(win)).toBe('connected')
  const second = await attendee(win)
  expect(second).not.toBe(first)
  expect(fake.calls.filter((call) => call.method === 'rooms.join')).toHaveLength(joinsBefore + 2)

  await bar.getByRole('button', { name: 'Leave' }).click()
  await expect(bar).toBeHidden()
  await chimeDrops(win, fake, second!)
}
