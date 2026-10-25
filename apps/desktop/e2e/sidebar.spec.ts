// The sidebar against the fake Slack: what shows after sign-in, the quick
// filters, a live update from another client and hover. The keyboard and the
// Unread hold are in the DOM lane (`dom/sidebar.test.ts`). The rows
// asserted on are threads the self user follows (started, replied in, or was
// mentioned in) and a channel's Main, so they stay in the sidebar under the
// followed-threads rule as well as the older every-active-thread rule.
import type { FakeSlack } from '@juno/fake-slack'
import { expect, syncedTest, test, type Fixtures } from './fixtures'
import type { Juno } from './driver/juno'

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

// Every test signs in and waits for the sync before it looks at rows.
test.describe.configure({ timeout: 60_000 })

// Titles are the first six words of the root message, so a prefix is enough.
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

syncedTest('shows sidebar rows and unread people, then filters and clears the list', async ({ juno, slack, fake }) => {
  const context = { juno, slack, fake }
  await test.step('after sign-in the sidebar lists followed threads and Main, newest first, with tags and counts', () => initialRows(context))
  await test.step('replies from another client update the row in place and move it to the top; the stack shows who wrote them, and nobody once the topic is read', () => unreadPeople(context))
  await test.step('the quick filters and the Unread toggle narrow the list, and an empty result offers to clear them', () => filterRows(context))
})

async function initialRows({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
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

async function unreadPeople({ juno, slack, fake }: Pick<Fixtures, 'juno' | 'slack' | 'fake'>): Promise<void> {
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

async function filterRows({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  const { sidebar } = juno
  await test.step('the quick filters narrow the list, DM rows show no people, and the Unread toggle hides read rows', async () => {
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
  await test.step('the empty state offers to clear the filters, and shows at once when it was just on screen', async () => {
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

    // Toggled off and on again within a second, it shows without its entrance (friendly-layer 5).
    await sidebar.toggleUnread()
    await sidebar.row(OFFSITE).expectVisible()
    await sidebar.toggleUnread()
    const title = sidebar.list.getByText("You're all caught up", { exact: true })
    await expect(title).toBeVisible()
    expect(await title.evaluate((node) => node.getAnimations().length)).toBe(0)

    await sidebar.clearFilters()
    await sidebar.row(POSTGRES).expectVisible()
  })
}

syncedTest('rows that scroll under a still pointer are not warmed; moving onto a row warms it', async ({ juno, win }) => {
  const { sidebar } = juno
  const list = sidebar.list
  await sidebar.hoverList()
  const before = await juno.lastMark('juno.prefetch')

  type Watched = HTMLElement & { scrollEnded?: Promise<void> }
  /** Turns the wheel over the list and waits for its scroll to end. The listener is in place before the wheel turns. */
  const wheel = async () => {
    const room = await list.evaluate((node: Watched) => {
      node.scrollEnded = new Promise((resolve) => node.addEventListener('scrollend', () => resolve(), { once: true }))
      return node.scrollHeight - node.clientHeight - node.scrollTop
    })
    await win.mouse.wheel(0, 300)
    // At the end of the list the wheel scrolls nothing, and no scrollend comes.
    if (room >= 1) await list.evaluate((node: Watched) => node.scrollEnded)
  }
  await wheel()
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await wheel()
  // The hover moves to the row now under the pointer on a frame after the scroll.
  await win.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await juno.lastMark('juno.prefetch')).toBe(before)

  // A real move onto another row warms it, as before.
  const box = (await list.boundingBox())!
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
  await expect.poll(() => juno.lastMark('juno.prefetch')).not.toBe(before)
})

// Zoom is main's: the View menu's items and the window's minimum size.
syncedTest('zooming in from the View menu keeps the whole sidebar inside the window', { tag: '@electron' }, async ({ juno, app, win }) => {
  await juno.sidebar.row(POSTGRES).expectVisible()

  // The smallest window, then View > Zoom In eight times (about 200%).
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    window.setSize(720, 480)
    const zoomIn = Menu.getApplicationMenu()!.getMenuItemById('zoom-in')!
    for (let step = 0; step < 8; step++) zoomIn.click(undefined, window)
  })
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor())).toBeGreaterThan(1.9)
  const right = (selector: string) => win.evaluate((query) => ({ right: document.querySelector(query)!.getBoundingClientRect().right, width: window.innerWidth }), selector)
  await expect.poll(async () => { const { right: edge, width } = await right('aside'); return edge <= width }).toBe(true)
  const account = await right('aside [aria-label="Account and settings"]')
  expect(account.right).toBeLessThanOrEqual(account.width)

  // The account menu ends inside the window; what does not fit scrolls inside it.
  await win.evaluate(() => document.querySelector<HTMLElement>('aside [aria-label="Account and settings"]')!.click())
  const menu = () => win.evaluate(() => ({ bottom: document.querySelector('[role="dialog"][aria-label="Account"]')?.getBoundingClientRect().bottom ?? Infinity, height: window.innerHeight }))
  await expect.poll(async () => { const { bottom, height } = await menu(); return bottom <= height }).toBe(true)
  await win.keyboard.press('Escape')

  // Actual Size brings the 720 × 480 minimum back.
  await app.evaluate(({ BrowserWindow, Menu }) => Menu.getApplicationMenu()!.getMenuItemById('zoom-reset')!.click(undefined, BrowserWindow.getAllWindows()[0]!))
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getMinimumSize())).toEqual([720, 480])
})

