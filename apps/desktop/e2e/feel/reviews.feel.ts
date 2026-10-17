// Home's review cards and the review sheet they share (SPEC 12,
// docs/design/settled-suggestions/): Tidy up, follow-ups that look done,
// threads you never open, channels you never read, and Automated's record.
// Each sheet opens with its rows in its first frame, and acting on a row
// keeps every row where it was: the row says what happened in the slot of
// its buttons, so nothing moves under the pointer.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { SELF_ID, type FakeSlack } from '@juno/fake-slack'
import { expect, launchApp } from '../fixtures'
import { Juno, pointAt, press, ReviewSheetPane, type HomeItemKind } from '../driver/juno'
import { answersWithin, feedbackInOneFrame, firstFrameRight, landsAndStays, noFlicker, noLayoutShift, opensWhole, switchesOnce } from './checks'
import { Feel, test } from './feel'
import { tag } from './pane'

test.describe.configure({ timeout: 240_000 })

const POSTGRES = 'Draft plan is in the doc'
const DAY = 24 * 60 * 60 * 1000

/** Home reads its items when it appears: show a topic, then Home again. */
async function freshHome(juno: Juno): Promise<string[]> {
  await juno.sidebar.filter('All')
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.home.open()
  return juno.home.kinds()
}

/**
 * Two scenarios on one card: open its sheet, then act on `row`. `name` is
 * the scenarios' prefix, `sheet` the sheet's `data-sheet`.
 */
async function reviewSheet(feel: Feel, juno: Juno, card: { readonly name: string; readonly kind: HomeItemKind; readonly sheet: string; readonly row: string }): Promise<void> {
  const { win } = juno
  const SHEET = `[data-sheet="${card.sheet}"]`
  const sheetProbes = [
    { kind: 'rect', name: 'sheet', selector: SHEET },
    { kind: 'text', name: 'sheetText', selector: `${SHEET} [data-review-heading]` },
    { kind: 'count', name: 'rows', within: 'body', selector: `${SHEET} li[data-review-row]` },
    { kind: 'boxes', name: 'rowBoxes', selector: `${SHEET} li[data-review-row]`, key: 'data-review-row' },
    { kind: 'rect', name: 'list', selector: `${SHEET} ul[data-review-list]` },
  ] as const
  // The row is the card's hover and press surface; its button opens the sheet.
  const opener = await tag(juno.home.item(card.kind), `${card.name}-opener`)
  await pointAt(win, juno.home.item(card.kind).locator('[data-home-review]'))
  await win.waitForTimeout(300)
  await feel.run(
    {
      name: `${card.name}-open`,
      title: `Open the ${card.name.replace('review-', '')} card's sheet from Home: it opens with its rows in its first frame, and they never move`,
      probes: [...sheetProbes, { kind: 'look', name: 'look', selector: opener }],
      regions: { sheet: SHEET },
      checks: [
        feedbackInOneFrame('look', 'pointerdown', 'the card press', { from: 'press' }),
        opensWhole('sheet', 'sheetText', 'the sheet', { from: 'press' }),
        firstFrameRight('the sheet has its rows in its first frame', (v) => v['sheet'] !== null, (v) => (Number(v['rows']) > 0 ? null : 'no rows')),
        landsAndStays('sheet', 'the sheet', { from: 'press' }),
        landsAndStays('list', 'the list', { from: 'press' }),
        landsAndStays('rowBoxes', 'the rows', { from: 'press', where: (v) => v['sheet'] !== null }),
        noFlicker('sheet', 'the sheet'),
      ],
    },
    async (rec) => {
      await rec.mark('press')
      await press(win)
      await expect(win.locator(SHEET)).toBeVisible()
    },
  )

  const row = new ReviewSheetPane(win, card.sheet).row(card.row)
  const act = await tag(row.locator('[data-review-act]'), `${card.name}-act`)
  await pointAt(win, win.locator(act))
  await win.waitForTimeout(300)
  await feel.run(
    {
      name: `${card.name}-act`,
      title: `Act on a row of the ${card.name.replace('review-', '')} sheet: the press shows at once, the row says what happened in place, and no row moves`,
      probes: [
        ...sheetProbes,
        { kind: 'look', name: 'look', selector: act },
        { kind: 'count', name: 'handled', within: 'body', selector: `${SHEET} li[data-review-row]:not([data-review-status="open"])` },
        { kind: 'rect', name: 'outcome', selector: `${SHEET} li[data-review-row]:not([data-review-status="open"]) [data-review-outcome]` },
      ],
      regions: { sheet: SHEET, list: `${SHEET} ul[data-review-list]` },
      checks: [
        feedbackInOneFrame('look', 'pointerdown', 'the button press', { from: 'press' }),
        // The row is the user's own action: it says so at once, before the engine answers.
        answersWithin('handled', 'pointerup', 'the row', { from: 'press', frames: 2 }),
        landsAndStays('outcome', 'the outcome'),
        landsAndStays('rowBoxes', 'the rows'),
        landsAndStays('list', 'the list'),
        // The list, not the whole sheet: the sheet's layer spans the window, and Move back puts a row in the sidebar under it.
        noLayoutShift({ region: 'list', includeInput: true }),
        noFlicker('sheet', 'the sheet'),
      ],
    },
    async (rec) => {
      await rec.mark('press')
      await press(win)
      await expect(row).not.toHaveAttribute('data-review-status', 'open')
    },
  )

  // Done: the sheet goes in one step back to Home.
  await feel.run(
    {
      name: `${card.name}-close`,
      title: `Close the ${card.name.replace('review-', '')} sheet with Done: it goes in one step, and Home is there under it`,
      probes: [
        { kind: 'count', name: 'sheet', within: 'body', selector: SHEET },
        { kind: 'count', name: 'home', within: 'body', selector: '[data-home] [data-home-item]' },
      ],
      regions: { window: 'body' },
      checks: [
        switchesOnce('the sheet', (v) => (Number(v['sheet']) > 0 ? 'sheet' : Number(v['home']) > 0 ? 'home' : 'empty')),
        noFlicker('window', 'the window'),
      ],
    },
    async (rec) => {
      await rec.mark('close')
      await win.locator(`${SHEET} [data-review-close]`).click()
      await expect(win.locator(SHEET)).toHaveCount(0)
    },
  )
}

test.describe('cards from the AI jobs', () => {
  test.use({ aiJobs: true })

  test('Tidy up: the sheet opens whole and a Resolve moves no row', async ({ juno, fake, win, feel }) => {
    const root = fake.workspace.post({ channel: 'C0INCIDENTS', user: 'U0DEV', text: 'The staging deploy keys need rotating before Friday', at: fake.now() - 3 * 3_600_000 })
    fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: SELF_ID, text: 'Rotated them this morning.', at: fake.now() - 150 * 60_000 })
    fake.workspace.post({ channel: 'C0INCIDENTS', threadTs: root.ts as never, user: 'U0DEV', text: 'Great, thanks', at: fake.now() - 2 * 3_600_000 })
    await juno.signIn()
    await juno.waitForSync()
    await juno.openSettings('Tidy up')
    await win.getByRole('radio', { name: '1 hour' }).click()
    await juno.tabs.close('Settings')
    await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('tidyUp')
    await reviewSheet(feel, juno, { name: 'review-tidy-up', kind: 'tidyUp', sheet: 'settled', row: 'The staging deploy keys need rotating' })
  })

  test('follow-ups that look done: the sheet opens whole and Mark done moves no row', async ({ juno, fake, feel }) => {
    await juno.signIn()
    await juno.waitForSync()
    await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('followUp')
    const root = fake.workspace.main('D0SAM')[0]!
    fake.workspace.post({ channel: 'D0SAM', threadTs: root.ts, user: SELF_ID, text: 'Left my notes on the packet: https://docs.example.com/packet-review' })
    await expect.poll(() => freshHome(juno), { timeout: 30_000 }).toContain('doneFollowUps')
    await reviewSheet(feel, juno, { name: 'review-follow-ups', kind: 'doneFollowUps', sheet: 'doneFollowUps', row: "You said you'd review Dev's packet this week" })
  })
})

/** A thread in #platform the user follows and never read: a root 20 days ago and seven replies since, the newest yesterday. */
function followedUnread(fake: FakeSlack, text: string): void {
  const root = fake.workspace.post({ channel: 'C0PLATFORM', user: 'U0DEV', text, at: fake.now() - 20 * DAY, silent: true })
  for (const [days, user] of [[18, 'U0LEO'], [15, 'U0MAYA'], [11, 'U0LEO'], [7, 'U0PRIYA'], [4, 'U0LEO'], [2, 'U0MAYA'], [1, 'U0LEO']] as const) {
    fake.workspace.post({ channel: 'C0PLATFORM', threadTs: root.ts, user, text: `Update from ${days} days ago`, at: fake.now() - days * DAY, silent: true })
  }
  fake.followThread({ channel: 'C0PLATFORM', threadTs: root.ts })
}

test('threads you never open: the sheet opens whole and Unfollow moves no row', async ({ juno, fake, feel }) => {
  followedUnread(fake, 'Billing queue rollout')
  followedUnread(fake, 'Pricing page copy')
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('unfollow')
  await reviewSheet(feel, juno, { name: 'review-unfollow', kind: 'unfollow', sheet: 'unfollow', row: 'Billing queue rollout' })
})

test('channels you never read: the sheet opens whole and Ignore moves no row', async ({ juno, fake, feel }) => {
  fake.addChannel({ id: 'C0BUILDS', name: 'build-chatter', messages: [{ user: 'U0LEO', text: 'Nightly builds move to 2am', ago: 40 * 24 * 60 }] })
  for (let i = 0; i < 55; i++) {
    fake.workspace.post({ channel: 'C0BUILDS', user: i % 2 === 0 ? 'U0LEO' : 'U0SAM', text: `Build ${i} is green`, at: fake.now() - 6 * DAY + i * 2 * 60 * 60_000, silent: true })
  }
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => freshHome(juno), { timeout: 60_000 }).toContain('ignore')
  await reviewSheet(feel, juno, { name: 'review-ignore', kind: 'ignore', sheet: 'ignore', row: '#build-chatter' })
})

test('old drafts: the sheet opens whole and Delete moves no row', async ({ juno, fake, slackApp, userData, running, studio }) => {
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const root = fake.workspace.main('C0ENG').find((message) => message.text?.startsWith(POSTGRES) === true)!
  const old = String(Date.now() - 15 * DAY)
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  const insert = db.prepare('INSERT INTO drafts (topic_id, text, updated_at) VALUES (?, ?, ?)')
  insert.run('m:C0ENG', 'Before the window we should', old)
  insert.run(`t:C0ENG:${root.ts}`, 'Can we move the cutover to', old)
  db.close()
  const relaunched = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const app = new Juno(relaunched.app, relaunched.win)
    await expect(app.home.navItem).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => freshHome(app), { timeout: 30_000 }).toContain('oldDrafts')
    await reviewSheet(new Feel(relaunched.win, studio, 'old drafts'), app, { name: 'review-old-drafts', kind: 'oldDrafts', sheet: 'oldDrafts', row: '#eng' })
  } finally {
    await relaunched.close()
  }
})

test("Automated's record: the sheet opens whole and Move back moves no row", async ({ juno, fake, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  fake.workspace.addConversation({ id: 'C0CIBUILDS', name: 'ci-builds', kind: 'public', members: new Set(['U0DEPLOYBOT']), created: fake.now(), topic: '', purpose: '', isOpen: true, archived: false })
  fake.joinChannel({ channel: 'C0CIBUILDS' })
  for (let n = 1; n <= 6; n++) fake.injectMessage({ channel: 'C0CIBUILDS', user: 'U0DEPLOYBOT', text: `main #${n} passed` })
  await expect.poll(() => freshHome(juno), { timeout: 30_000 }).toContain('automatedMoves')
  await reviewSheet(feel, juno, { name: 'review-automated', kind: 'automatedMoves', sheet: 'automated', row: '#ci-builds' })
})
