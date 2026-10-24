// Home's other suggestions (SPEC 12, docs/design/settled-suggestions/, "More
// self-management"): Unfollow threads you never open and Ignore channels you
// never read, each a card opening a review with the reason, the action, Undo
// and the no; and a direct mention of you breaking through an ignored
// channel (SPEC 5 and 14), while @here does not.
import type { FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'
import { loggedDecision } from './driver/notificationLog'

test.describe.configure({ timeout: 150_000 })

const DAY = 24 * 60 * 60 * 1000
const POSTGRES = 'Draft plan is in the doc'
const QUEUE = 'Billing queue rollout'
const PRICING = 'Pricing page copy'
const BUILDS = '#build-chatter'

/** Home reads its items when it appears: show a topic, then Home again. */
async function freshHome(juno: Juno): Promise<string[]> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.home.open()
  return juno.home.kinds()
}

/** A thread in #platform the user follows and never read: a root 20 days ago and seven replies since, the newest yesterday. */
function followedUnread(fake: FakeSlack, text: string): string {
  const root = fake.workspace.post({ channel: 'C0PLATFORM', user: 'U0DEV', text, at: fake.now() - 20 * DAY, silent: true })
  for (const [days, user] of [[18, 'U0LEO'], [15, 'U0MAYA'], [11, 'U0LEO'], [7, 'U0PRIYA'], [4, 'U0LEO'], [2, 'U0MAYA'], [1, 'U0LEO']] as const) {
    fake.workspace.post({ channel: 'C0PLATFORM', threadTs: root.ts, user, text: `Update from ${days} days ago`, at: fake.now() - days * DAY, silent: true })
  }
  fake.followThread({ channel: 'C0PLATFORM', threadTs: root.ts })
  return root.ts
}

test('Unfollow threads you never open: the reason, what Slack sees, Unfollow, Undo, Keep following, and a mention follows again', async ({ juno, fake }) => {
  const queue = followedUnread(fake, QUEUE)
  followedUnread(fake, PRICING)
  const followed = () => fake.workspace.subscription('C0PLATFORM', queue)?.subscribed
  await juno.signIn()
  await juno.waitForSync()

  await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('unfollow')
  await expect(juno.home.title('unfollow')).toHaveText('2 threads you never open')
  await expect(juno.home.meta('unfollow')).toHaveText('platform')

  const sheet = await juno.home.reviewOf('unfollow', 'unfollow')
  await expect(sheet.title).toHaveText('2 threads you never open')
  // The sheet says what happens in Slack before anything is done; the key phrase only, so a copy edit does not fail it.
  await expect(sheet.lead).toContainText('in Slack')
  await expect(sheet.reason(QUEUE)).toHaveText(/^(At least )?7 replies, never opened$/)

  // Unfollow: the row stays and says so, and Slack unfollows; the thread leaves the sidebar once the sheet closes.
  await sheet.act(QUEUE).click()
  await expect(sheet.row(QUEUE)).toHaveAttribute('data-review-status', 'done')
  await juno.expectToast(`Unfollowed · ${QUEUE}`)
  await expect.poll(followed).toBe(false)
  // The sidebar holds behind the sheet (SPEC 5).
  await juno.sidebar.row(QUEUE).expectVisible()

  // Undo on the row follows it again in Slack.
  await sheet.undo(QUEUE).click()
  await expect(sheet.row(QUEUE)).toHaveAttribute('data-review-status', 'open')
  await expect.poll(followed).toBe(true)
  await juno.sidebar.row(QUEUE).expectVisible()

  // Keep following, from the keyboard: K on the focused row.
  await sheet.row(PRICING).getByRole('link').focus()
  await juno.win.keyboard.press('k')
  await expect(sheet.row(PRICING)).toHaveAttribute('data-review-status', 'declined')
  await juno.expectToast(`Still following · ${PRICING}`)

  // Unfollow again; then someone mentions you in the thread, and you follow it again, as in Slack.
  await sheet.act(QUEUE).click()
  await expect.poll(followed).toBe(false)
  await juno.win.keyboard.press('Escape')
  await expect(sheet.root).toHaveCount(0)
  // Closed, the unfollowed thread leaves the sidebar.
  await juno.sidebar.row(QUEUE).expectAbsent()
  fake.injectMessage({ channel: 'C0PLATFORM', threadTs: queue, user: 'U0MAYA', text: '<@U0TUSHAR> can you check the numbers before Friday?' })
  await expect.poll(followed).toBe(true)
  await juno.sidebar.row(QUEUE).expectVisible()

  // The kept thread is not suggested again, and the followed one has an unread mention.
  expect(await freshHome(juno)).not.toContain('unfollow')
})

test('Ignore channels you never read: the reason, nothing in Slack, Ignore, Undo, Settings › Ignored and Keep showing', async ({ juno, fake }) => {
  // Nothing read in #build-chatter since a message 40 days ago, and 55 messages in the last week.
  fake.addChannel({ id: 'C0BUILDS', name: 'build-chatter', messages: [{ user: 'U0LEO', text: 'Nightly builds move to 2am', ago: 40 * 24 * 60 }] })
  for (let i = 0; i < 55; i++) {
    fake.workspace.post({ channel: 'C0BUILDS', user: i % 2 === 0 ? 'U0LEO' : 'U0SAM', text: `Build ${i} is green`, at: fake.now() - 6 * DAY + i * 2 * 60 * 60_000, silent: true })
  }
  await juno.signIn()
  await juno.waitForSync()

  await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('ignore')
  await expect(juno.home.title('ignore')).toHaveText('1 channel you never read')
  await expect(juno.home.meta('ignore')).toHaveText('build-chatter')

  let sheet = await juno.home.reviewOf('ignore', 'ignore')
  await expect(sheet.lead).toContainText('Nothing changes in Slack')
  await expect(sheet.reason(BUILDS)).toHaveText(/^(At least )?55 messages since the last one you read, 5 weeks ago$/)
  await sheet.about.click()
  await expect(sheet.explainer).toContainText('@here')
  // The info opens over the list: close it before acting.
  await sheet.about.click()
  await expect(sheet.explainer).toHaveCount(0)

  // Ignore hides it from the sidebar once the sheet closes; the row's Undo takes it back.
  await sheet.act(BUILDS).click()
  await expect(sheet.row(BUILDS)).toHaveAttribute('data-review-status', 'done')
  await juno.expectToast(`Ignoring ${BUILDS}`)
  // The sidebar holds behind the sheet (SPEC 5).
  await juno.sidebar.row(BUILDS).expectVisible()
  await sheet.undo(BUILDS).click()
  await expect(sheet.row(BUILDS)).toHaveAttribute('data-review-status', 'open')
  await juno.sidebar.row(BUILDS).expectVisible()

  // Ignore again: Settings › Ignored lists it, and Stop ignoring brings it back.
  await sheet.act(BUILDS).click()
  await juno.win.keyboard.press('Escape')
  await juno.sidebar.row(BUILDS).expectAbsent()
  await juno.openSettings('Ignored')
  await expect(juno.settings.ignored('build-chatter')).toBeVisible()
  await juno.settings.stopIgnoring('build-chatter')
  await juno.expectToast('Stopped ignoring #build-chatter')

  // The suggestion comes back; Keep showing stops it.
  await expect.poll(() => freshHome(juno), { timeout: 30_000 }).toContain('ignore')
  sheet = await juno.home.reviewOf('ignore', 'ignore')
  await sheet.decline(BUILDS).click()
  await expect(sheet.row(BUILDS)).toHaveAttribute('data-review-status', 'declined')
  await juno.expectToast(`Still showing ${BUILDS}`)
  await juno.win.keyboard.press('Escape')
  expect(await freshHome(juno)).not.toContain('ignore')
  await juno.sidebar.row(BUILDS).expectVisible()
})

test('a mention of you, or of your group, breaks through an ignored channel; @here does not', async ({ juno, fake, userData }) => {
  fake.setSelfUsergroups({ ids: ['S0PLATFORM'] })
  await juno.signIn()
  await juno.waitForSync()

  // Inside the hours, mentions notify by the Mentions switch; then ignore #incidents.
  await juno.notificationHoursNow()
  await juno.sidebar.row('#incidents').chooseInMenu('ignore-channel')
  await juno.expectToast('Ignoring #incidents')
  await juno.sidebar.row('#incidents').expectAbsent()

  await juno.blurWindow()
  const bodies = async () => (await juno.osNotifications()).map((notification) => notification.body)
  fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0LEO', text: '<!here> the deploy freeze starts at 3' })
  fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0MAYA', text: '<@U0TUSHAR> can you approve the rollback?' })
  await expect.poll(async () => (await bodies()).some((body) => body.includes('can you approve the rollback?')), { timeout: 15_000 }).toBe(true)
  // The group mention gets through too; within 10 seconds of that banner the burst rule keeps it quiet, later it notifies.
  fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0LEO', text: '<!subteam^S0PLATFORM> please check the dashboards' })
  await expect.poll(() => loggedDecision(userData, fake.teamId, 'please check the dashboards')?.decidedBy, { timeout: 15_000 }).toMatch(/^(burst|directMention)$/)
  expect(loggedDecision(userData, fake.teamId, 'the deploy freeze starts at 3')).toEqual({ outcome: 'stay', decidedBy: 'ignored' })
  expect((await bodies()).some((body) => body.includes('deploy freeze'))).toBe(false)
  await juno.focusWindow()

  // Home names who mentioned you; the channel stays out of the sidebar, and the row opens the topic.
  await expect.poll(() => freshHome(juno), { timeout: 30_000 }).toContain('mentioned')
  await expect(juno.home.title('mentioned')).toHaveText('Leo mentioned you in #incidents')
  await juno.sidebar.row('#incidents').expectAbsent()
  await juno.home.openItem('mentioned')
  await juno.topic.expectTitle('incidents')
  await juno.topic.expectMessage('can you approve the rollback?')
})
