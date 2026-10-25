// The sidebar against the fake Slack: what shows after sign-in, a live update from another
// client, the quick filters, and the Unread filter keeping a read topic while a tab shows it
// (SPEC 5, "Holding the order"). That the opened row's box holds still is the browser lane's
// layout-shift guard; here the order and the rows. The rows asserted on are threads the self
// user follows and a channel's Main, so they stay under the followed-threads rule.
import type { FakeSlack } from '@juno/fake-slack'
import type { Slack } from '../e2e/driver/slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest, type DomContext } from './test'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'
const ALERTS_MAIN = '#alerts-prod'

/**
 * A new message in #incidents' Main, so a row sits above the Postgres
 * thread: after the first sync it is the newest in All, since Automated
 * keeps the busier bot channels out.
 */
async function postAbovePostgres(juno: Juno, fake: FakeSlack): Promise<void> {
  fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0JONAS', text: 'Paging drill at 3pm.' })
  await expect.poll(() => juno.sidebar.titles('Recent').then((titles) => titles[0])).toBe('#incidents')
}

domTest('shows sidebar rows and unread people, then filters and clears the list', async ({ juno, slack, fake, step }) => {
  await step('after sign-in the sidebar lists followed threads and Main, newest first, with tags and counts', () => initialRows(juno))
  await step('replies from another client update the row in place and move it to the top; the stack shows who wrote them, and nobody once the topic is read', () => unreadPeople(juno, slack, fake))
  await step('the quick filters and the Unread toggle narrow the list, and an empty result offers to clear them', () => filterRows(juno, fake, step))
})

async function initialRows(juno: Juno): Promise<void> {
  const { sidebar } = juno

  // Nothing is pinned yet, so there is one section and no "Recent" label over it.
  await sidebar.expectNoSection('Pinned')
  await expect(sidebar.section('Recent').getByRole('heading', { name: 'Recent' })).toHaveCount(0)

  // A thread the user replied in: read, so a medium title and no count.
  const postgres = sidebar.row(POSTGRES)
  await postgres.expectVisible()
  await postgres.expectRead()
  await postgres.expectPreview('Dev: Booked 2–4pm. Will post results here.')
  await postgres.expectChannel('eng')
  // Read, so no people: the stack names only who is talking in unread messages.
  await expect(postgres.root.getByRole('img', { name: /Dev|Leo/ })).toHaveCount(0)

  // A thread with an unread mention: semibold title, the @ tag, then the count.
  const rina = sidebar.row(RINA)
  await rina.expectUnread(2)
  await rina.expectMention()
  await rina.expectChannel('hiring')

  // A thread with unread replies and a mention in the latest one.
  const roadmap = sidebar.row(ROADMAP)
  await roadmap.expectUnread(3)
  await roadmap.expectMention()
  await roadmap.expectPreview(/^Maya: Draft is up\. Cross-posting to #leadership once @Tushar has looked\./)

  // Newest activity first. #alerts-prod, newer than all of them, is a bot channel: Automated keeps it out of All.
  const titles = await sidebar.titles('Recent')
  const at = (prefix: string) => titles.findIndex((title) => title.startsWith(prefix))
  expect(at(ALERTS_MAIN)).toBe(-1)
  expect(at(POSTGRES)).toBeGreaterThanOrEqual(0)
  expect(at(POSTGRES)).toBeLessThan(at(RINA))
  expect(at(RINA)).toBeLessThan(at(ROADMAP))
  expect(at(ROADMAP)).toBeLessThan(at(OFFSITE))

  // A channel's Main, in the Automated view. How a Main row looks is in the gallery (list-geometry.spec.ts).
  await sidebar.selectView('Automated')
  const alerts = sidebar.row(ALERTS_MAIN)
  // Nine unread, exactly: the boot's history page reaches back to the read pointer.
  await expect(alerts.root.getByTitle(/^9 unread$/)).toHaveText('9')
  await alerts.expectPreview('Grafana: [RESOLVED] queue depth > 5k on billing-consumer')
  await sidebar.filter('All')

  // Both groups have unread topics, so both dots show.
  await sidebar.expectFilterDot('Channels', true)
  await sidebar.expectFilterDot('DMs', true)
}

async function unreadPeople(juno: Juno, slack: Slack, fake: FakeSlack): Promise<void> {
  const { sidebar } = juno
  const postgres = sidebar.row(POSTGRES)
  await postgres.expectRead()
  // Away from the list, so it does not hold its order.
  await sidebar.leave()
  await postAbovePostgres(juno, fake)

  slack.as('Leo').replyIn(POSTGRES, 'Cutover is a go')
  slack.as('Maya').replyIn(POSTGRES, 'Rollback steps are in the doc')
  // The replies from another client update the row in place and move it to the top.
  await postgres.expectPreview('Maya: Rollback steps are in the doc')
  await postgres.expectUnread(2)
  await expect.poll(() => sidebar.titles('Recent').then((titles) => titles[0])).toBe(POSTGRES)
  // The time from the engine's write to pixels is measured in perf.spec.ts.

  // Most recent first; the fake's display names are first names.
  const stack = postgres.root.getByRole('img', { name: 'Maya, Leo', exact: true })
  await expect(stack).toBeVisible()

  await postgres.open()
  await postgres.expectRead()
  await expect(stack).toHaveCount(0)
  await expect(postgres.root.getByRole('img', { name: /Maya|Leo/ })).toHaveCount(0)
}

async function filterRows(juno: Juno, fake: FakeSlack, step: DomContext['step']): Promise<void> {
  const { sidebar } = juno
  await step('the quick filters narrow the list, DM rows show no people, and the Unread toggle hides read rows', async () => {
    await sidebar.row(POSTGRES).expectVisible()
    await sidebar.row(OFFSITE).expectVisible()

    await sidebar.filter('Channels')
    await sidebar.row(OFFSITE).expectAbsent()
    await sidebar.row(POSTGRES).expectVisible()
    // The dot only marks the group that is not being viewed.
    await sidebar.expectFilterDot('Channels', false)
    await sidebar.expectFilterDot('DMs', true)

    await sidebar.filter('DMs')
    await sidebar.row(POSTGRES).expectAbsent()
    await sidebar.row(OFFSITE).expectVisible()
    // A thread in the DM with Maya, the DM's Main and the group DM's Main: the
    // title or the channel already names the people, so no row has a people stack.
    for (const row of [sidebar.row(OFFSITE).root, juno.win.locator('[data-topic-id="m:D0MAYA"]'), juno.win.locator('[data-topic-id="m:G0MAYALEO"]')]) {
      await expect(row).toBeVisible()
      await expect(row.getByRole('img')).toHaveCount(0)
    }
    await sidebar.expectFilterDot('Channels', true)
    await sidebar.expectFilterDot('DMs', false)

    await sidebar.filter('All')
    await sidebar.row(POSTGRES).expectVisible()

    await sidebar.toggleUnread()
    await sidebar.row(POSTGRES).expectAbsent()
    await sidebar.row(RINA).expectVisible()
    await sidebar.row(OFFSITE).expectVisible()

    await sidebar.toggleUnread()
    await sidebar.row(POSTGRES).expectVisible()
  })
  await step('the empty state offers to clear the filters, and shows at once when it was just on screen', async () => {
    await sidebar.row(OFFSITE).expectVisible()

    // Reading the DM threads from another client leaves nothing unread in DMs.
    for (const channel of ['D0MAYA', 'D0SAM', 'G0MAYALEO']) {
      const last = fake.messages(channel).at(-1)!
      fake.markRead({ channel, ts: last.ts })
      for (const root of fake.messages(channel).filter((message) => message.reply_count !== undefined && message.reply_count > 0)) {
        fake.markThreadRead({ channel, threadTs: root.ts, ts: last.ts })
      }
    }
    await sidebar.filter('DMs')
    await sidebar.toggleUnread()
    await sidebar.expectEmpty("You're all caught up")

    // Toggled off and on again, it shows again.
    await sidebar.toggleUnread()
    await sidebar.row(OFFSITE).expectVisible()
    await sidebar.toggleUnread()
    await expect(sidebar.list.getByText("You're all caught up", { exact: true })).toBeVisible()

    await sidebar.clearFilters()
    await sidebar.row(POSTGRES).expectVisible()
  })
}


domTest('Unread keeps read topics until no tab shows them', async ({ juno }) => {
  const { sidebar, tabs } = juno
  await sidebar.toggleUnread()
  const rina = sidebar.row(RINA)
  const roadmap = sidebar.row(ROADMAP)
  await rina.expectUnread(2)
  const before = await sidebar.titles()
  await rina.open()
  await rina.expectRead()
  await rina.expectSelected()
  expect(await sidebar.titles()).toEqual(before)

  await roadmap.open()
  await roadmap.expectRead()
  await roadmap.expectSelected()
  // Rina's row leaves once the pointer leaves the list, which holds its rows meanwhile.
  await expect(rina.root).toHaveCount(1)
  await sidebar.leave()
  await expect(rina.root).toHaveCount(0)

  // Two tabs show the same read topic. Closing one must leave its row.
  await roadmap.openInNewTab()
  await tabs.expectCount(2)
  await tabs.menu('close-tab')
  await tabs.expectCount(1)
  await roadmap.expectRead()
  await roadmap.expectSelected()
  await tabs.menu('close-tab')
  await sidebar.leave()
  await expect(roadmap.root).toHaveCount(0)
})

domTest('pressing a row selects it, the keyboard moves the selection, and arrowing to a row only focuses it', async ({ juno, fake, step }) => {
  const { sidebar, win } = juno
  await step('pressing a row selects it, and the keyboard moves the selection', async () => {
    const titles = await sidebar.titles('Recent')
    const first = sidebar.row(titles[0]!)
    const second = sidebar.row(titles[1]!)
    const third = sidebar.row(titles[2]!)

    await second.select()
    await second.expectSelected()
    await first.expectSelected(false)
    // An open from a row keeps focus on that row (SPEC 6, "Ready to type").
    await second.expectFocused()

    // Arrows move focus between rows; Enter makes the focused row the selection.
    await second.focus()
    await win.keyboard.press('ArrowDown')
    await third.expectFocused()
    await win.keyboard.press('Enter')
    await third.expectSelected()
    await second.expectSelected(false)

    await win.keyboard.press('ArrowUp')
    await win.keyboard.press('ArrowUp')
    await first.expectFocused()
    await win.keyboard.press('End')
    await sidebar.row(titles[titles.length - 1]!).expectFocused()
    await win.keyboard.press('Home')
    await first.expectFocused()
    // One row is in the Tab order: the one focused last, so Tab leaves the list and Shift-Tab comes back to it.
    await expect(first.root).toHaveAttribute('tabindex', '0')
    await expect(third.root).toHaveAttribute('tabindex', '-1')
  })
  // Let go of the list, pointer and focus, so it no longer holds its order and the next row can move to the top.
  win.active?.blur()
  await sidebar.leave()
  await step('arrowing to a row focuses it without selecting it', async () => {
    // A new message in #incidents' Main puts its row above the Postgres thread.
    fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0JONAS', text: 'Paging drill at 3pm.' })
    await sidebar.expectTop('#incidents')
    const titles = await sidebar.titles('Recent')
    const first = sidebar.row(titles[0]!)
    const postgres = sidebar.row(POSTGRES)
    const steps = titles.findIndex((title) => title.startsWith(POSTGRES))
    expect(steps).toBeGreaterThan(0)

    // The first row is selected; the Postgres thread is reached with the keyboard only.
    await first.select()
    await first.expectSelected()
    await first.expectFocused()
    for (let i = 0; i < steps; i++) await win.keyboard.press('ArrowDown')
    await postgres.expectFocused()
    await postgres.expectSelected(false)
  })
})
