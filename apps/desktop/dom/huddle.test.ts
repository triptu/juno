/**
 * Huddles (SPEC 20) as the user meets them, against the fake Slack on
 * `huddles_arch_v2`. Under JUNO_E2E the page runs the fake media session
 * (`@juno/huddle-media/fake`), which the test drives through
 * `window.__junoHuddleMedia`; no test talks to Chime. On v2 Slack learns of a
 * leave from Chime, so the test tells the fake when the page's media stopped
 * (`stopMedia`), as Chime would. Screen shares and main's Huddle menu and
 * quit dialog stay in `e2e/huddle.spec.ts`.
 */
import { TEAM } from '@juno/fake-slack'
import { expect } from './expect'
import { addRemote, attendee, chimeDrops, connection, endMedia, localMuted, played, startHuddleFromMenu } from './huddle'
import { domTest, type DomContext } from './test'

domTest('start a huddle from the topic menu, mute from the bar, open the tab and leave; join it again, and Join here after joining on another device', async ({ juno, fake, step }) => {
  await step('start a huddle from the topic menu, mute from the bar, open the tab and leave', () => startAndLeave({ juno, fake }))
  await step('join a running huddle, and Join here after joining on another device', () => joinAgain({ juno, fake }))
}, { timeout: 90_000 })

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
