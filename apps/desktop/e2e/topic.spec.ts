// Reading a topic against the fake Slack: where it opens, the read rule,
// older pages without a shift, Main's thread links, the title's topic switcher and ⋯, a
// #channel chip, and prefetch.
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const CHECKOUT = 'checkout.spec failed again on main.'
const ENG_MAIN = '#eng'

test('a topic with unread messages opens at the "N new" divider and is marked read', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const rina = juno.sidebar.row(RINA)
  await rina.expectUnread(2)

  await rina.open()
  await juno.topic.expectTitle(RINA)
  await juno.topic.expectDividerBefore('Strong systems design')
  await juno.topic.expectNew(2)
  await rina.expectRead()
  // The divider stays where the pointer was when the topic opened.
  await juno.topic.expectNew(2)
  // The thread is followed, so the mark reaches Slack.
  await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.mark'), { timeout: 10_000 }).toBe(true)
})

test('a read topic opens at the bottom with no divider', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectMessage('Booked 2–4pm')
  await juno.topic.expectNoDivider()
  await juno.topic.expectAtBottom()
})

test('Main shows thread links; a link opens the thread in the tab, and the title switches to another thread', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const main = juno.sidebar.row(ENG_MAIN)
  await main.expectNewThreads(1)
  await main.open()
  await juno.topic.expectTitle('Main')
  await expect(juno.topic.contextPill).toHaveAccessibleName('eng, public channel. Show in sidebar.')
  await expect(juno.topic.threadLink(/^6 replies: Draft plan/).root).toBeVisible()

  await juno.topic.threadLink(/^6 replies: Draft plan/).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.expectCount(1)

  // The switcher: Main first and marked from Main, then the threads; opening an unfollowed thread does not add it to the sidebar.
  await main.open()
  let switcher = await juno.topic.openSwitcher()
  await expect(switcher.row('Main')).toHaveAttribute('aria-selected', 'true')
  await expect(switcher.search).toBeFocused()
  await switcher.open(CHECKOUT)
  await juno.topic.expectTitle(CHECKOUT)
  await juno.tabs.expectCount(1)
  await juno.sidebar.row(CHECKOUT).expectAbsent()

  // From a thread, back to Main and to a sibling thread; the current one is marked.
  switcher = await juno.topic.openSwitcher()
  await expect(switcher.row(CHECKOUT)).toHaveAttribute('aria-selected', 'true')
  await switcher.open(POSTGRES)
  await juno.topic.expectTitle(POSTGRES)

  // From the keyboard: Enter on the title opens it with the search focused and the current topic highlighted,
  // Home moves to Main, Enter opens, Escape returns to the title.
  switcher = await juno.topic.openSwitcherWithKeyboard()
  await expect(switcher.search).toBeFocused()
  await expect(switcher.search).toHaveAttribute('aria-activedescendant', (await switcher.row(POSTGRES).getAttribute('id'))!)
  await juno.win.keyboard.press('Escape')
  await expect(switcher.root).toHaveCount(0)
  await expect(juno.topic.titleButton).toBeFocused()
  switcher = await juno.topic.openSwitcherWithKeyboard()
  await juno.win.keyboard.press('Home')
  await juno.win.keyboard.press('Enter')
  await juno.topic.expectTitle('Main')
  await juno.tabs.expectCount(1)
})

test('⋯ opens the topic menu under the right island, as a right-click on the title does, and Notify me follows and unfollows the thread', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const rina = juno.sidebar.row(RINA)
  await rina.open()
  await juno.topic.expectTitle(RINA)
  await expect(juno.topic.titleButton).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(juno.topic.moreButton).toHaveAttribute('aria-haspopup', 'menu')

  // Never unfollows the thread in Slack, so it leaves the sidebar. The tab stays open on it.
  const never = await juno.topic.chooseInMenu('notify-never')
  expect(never.labels).toEqual([
    'Open in new tab',
    '-',
    'Rename',
    'Redraw',
    'Mark as unread',
    'Pin',
    'Resolve',
    '-',
    'Copy Slack link',
    'Open in Slack',
    'Notify me',
    '> Every message',
    '> When it matters ✓',
    '> Never',
    'Ignore #hiring',
  ])
  // At ⋯'s left edge, 6px under the right island.
  const island = (await juno.topic.header.locator('[data-island="right"]').boundingBox())!
  const more = (await juno.topic.moreButton.boundingBox())!
  expect(never.at).not.toBeNull()
  expect(Math.round(never.at!.x)).toBe(Math.round(more.x))
  expect(Math.round(never.at!.y - (island.y + island.height))).toBe(6)
  await rina.expectAbsent()
  await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.remove'), { timeout: 10_000 }).toBe(true)

  // Every message follows it again, and it comes back; a right-click on the title shows the same menu, under the left island.
  const every = await juno.topic.chooseInTitleMenu('notify-every')
  expect(every.labels.slice(0, 7)).toEqual(never.labels.slice(0, 7))
  const left = (await juno.topic.header.locator('[data-island="left"]').boundingBox())!
  expect(Math.round(every.at!.x)).toBe(Math.round(left.x))
  expect(every.labels).toContain('> Never ✓')
  await rina.expectVisible()
  await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.add'), { timeout: 10_000 }).toBe(true)
})

test('an unfollowed thread opened from Main shows Follow in Resolve’s place; a click follows it with When it matters, no menu, and ⌘Z undoes it', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.threadLink(/checkout\.spec failed/).open()
  await juno.topic.expectTitle(CHECKOUT)
  const header = juno.topic.header
  const resolve = header.getByRole('button', { name: 'Resolve', exact: true })
  const checkout = juno.sidebar.row(CHECKOUT)
  await expect(juno.topic.followButton).toBeVisible()
  await expect(juno.topic.followButton).not.toHaveAttribute('aria-haspopup')
  await expect(resolve).toHaveCount(0)
  await checkout.expectAbsent()
  const follow = (await juno.topic.followButton.boundingBox())!
  const title = (await juno.topic.titleButton.boundingBox())!

  // One click follows it, with no menu: When it matters, as Notify me sets it.
  const { menuOpened } = await juno.topic.follow()
  expect(menuOpened).toBe(false)
  await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.add' && call.args['channel'] === 'C0ENG'), { timeout: 10_000 }).toBe(true)
  await juno.expectToast('When it matters')
  await checkout.expectVisible()
  await expect(resolve).toBeVisible()
  // Resolve took Follow's place at Follow's width; the title did not move.
  const swapped = (await resolve.boundingBox())!
  expect(Math.round(swapped.x)).toBe(Math.round(follow.x))
  expect(Math.round(swapped.width)).toBe(Math.round(follow.width))
  expect(await juno.topic.titleButton.boundingBox()).toEqual(title)

  // ⌘Z unfollows it again: it leaves the sidebar and the header shows Follow.
  await juno.undo()
  await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.remove'), { timeout: 10_000 }).toBe(true)
  await checkout.expectAbsent()
  await expect(juno.topic.followButton).toBeVisible()
  await expect(resolve).toHaveCount(0)
})

test('after Follow, Notify me in ⋯ shows When it matters and changes it', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.threadLink(/checkout\.spec failed/).open()
  await juno.topic.expectTitle(CHECKOUT)
  expect((await juno.topic.follow()).menuOpened).toBe(false)
  await juno.expectToast('When it matters')

  // ⋯ › Notify me has When it matters checked; Every message replaces it, and the thread stays followed.
  const every = await juno.topic.chooseInMenu('notify-every')
  expect(every.labels).toContain('> When it matters ✓')
  await juno.expectToast('Every message')
  const after = await juno.topic.chooseInMenu('copy-link')
  expect(after.labels).toContain('> Every message ✓')
  await juno.sidebar.row(CHECKOUT).expectVisible()
  await expect(juno.topic.header.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible()
})

test('Main’s Notify me is its channel’s, and the header is reached pill, title, ⋯, Juno', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
  const { labels } = await juno.topic.chooseInMenu('copy-link')
  expect(labels).toContain('Notify me')
  expect(labels).toContain('> When it matters ✓')
  expect(labels).not.toContain('Rename')

  await juno.topic.contextPill.focus()
  const order: string[] = []
  for (let i = 0; i < 4; i++) {
    order.push(await win.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? ''))
    await win.keyboard.press('Tab')
  }
  expect(order).toEqual(['eng, public channel. Show in sidebar.', 'Main', 'More', 'Juno ⌘J'])
  // Juno is on unless AI assist is off, so the header has its button.
  await expect(juno.topic.header.getByRole('button', { name: 'Juno ⌘J' })).toBeVisible()
})

test('the context pill scopes the sidebar to its channel', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.contextPill.click()
  await juno.sidebar.expectScope('eng')
})

test('a #channel chip scopes the sidebar to that channel', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.clickChannel('platform')
  await juno.sidebar.expectScope('platform')
  await juno.sidebar.row(POSTGRES).expectAbsent()
})

test('hovering a row warms the topic without asking Slack', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  slack.resetCalls()
  await juno.sidebar.row(POSTGRES).hover()
  await juno.win.waitForTimeout(500)
  expect(slack.fake.calls.map((call) => call.method)).toEqual([])
  // The open is a cache hit: the tab paints with its rows.
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectMessage('Booked 2–4pm')
  await expect.poll(() => juno.measure('juno.topic-open')).toBeLessThan(250)
})

test.describe('a long thread', () => {
  const longTest = test.extend({
    // oxlint-disable-next-line no-empty-pattern
    fake: async ({}, use) => {
      const fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
      await use(fake)
      await fake.close()
    },
  })
  const THREAD = 'Review the rollout checklist 1'

  longTest('opens with the first new reply 80px below the header band, and older pages load without moving what is on screen', async ({ juno, slack }) => {
    await juno.signIn()
    await juno.waitForSync()
    const row = juno.sidebar.row(THREAD)
    // The first open reads the whole thread; close it and let 40 replies arrive.
    await row.open()
    await juno.topic.expectAtBottom()
    await row.expectRead()
    await juno.tabs.close(THREAD)
    for (let i = 0; i < 40; i++) slack.as('Leo').replyIn(THREAD, `Follow-up ${i + 1} on the checklist.`)
    await row.expectUnread(40)

    await row.open()
    await juno.topic.expectDividerBefore('Follow-up 1 on the checklist.')
    await juno.topic.expectThumbnailsLoaded()
    // The list runs under the 68px band, so 80px below it is 148px from the list's top.
    expect(Math.round(await juno.topic.dividerOffset())).toBe(148)
    await juno.topic.expectNew(40)

    // Up to the top: the next page goes in above the rows in view, which stay put.
    const before = await juno.topic.rowCount()
    let anchor = await juno.topic.firstVisibleRow()
    const report = await measureLayoutShift(
      juno.win,
      async () => {
        await juno.topic.scrollToTop()
        anchor = await juno.topic.firstVisibleRow()
        await expect.poll(() => juno.topic.rowCount(), { timeout: 15_000 }).toBeGreaterThan(before)
      },
      { root: '[data-topic-view]', settleMs: 200 },
    )
    expect(await juno.topic.rowTop(anchor.ts)).toBeCloseTo(anchor.top, 0)
    expect(report.shifts).toEqual([])
  })
})

test('at the minimum window size the topic switcher stays inside the workspace', async ({ juno, app, win }) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(720, 480))
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(ENG_MAIN).open()
  const switcher = await juno.topic.openSwitcher()
  const pane = (await win.getByRole('region', { name: 'Workspace' }).boundingBox())!
  const list = (await switcher.root.boundingBox())!
  expect(list.x).toBeGreaterThanOrEqual(pane.x)
  expect(list.x + list.width).toBeLessThanOrEqual(pane.x + pane.width)
})

test('every control in the header answers hover and press', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const header = juno.topic.header
  const controls = [
    header.getByRole('button', { name: 'Resolve', exact: true }),
    juno.topic.titleButton,
    header.getByRole('button', { name: /Show in sidebar/ }),
    header.getByRole('button', { name: 'Juno ⌘J' }),
    juno.topic.moreButton,
  ]
  const look = (control: (typeof controls)[number]) =>
    control.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, scale: style.scale }
    })
  const away = () => win.mouse.move(5, 300)

  for (const control of controls) {
    if ((await control.count()) === 0) continue
    const name = (await control.getAttribute('aria-label')) ?? (await control.textContent())
    await away()
    const rest = await look(control)
    await control.hover()
    await expect.poll(async () => (await look(control)).background, { message: `hover on ${name}` }).not.toBe(rest.background)
    await win.mouse.down()
    await expect.poll(async () => (await look(control)).scale, { message: `press on ${name}` }).not.toBe(rest.scale)
    // Let go away from the control, so the press does nothing.
    await away()
    await win.mouse.up()
  }
})

test('the switcher searches the channel’s topics, and ⌘ opens one in a new tab', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)

  // Typing narrows the list to titles whose words start with the query; Main goes, the match stays.
  const switcher = await juno.topic.openSwitcher()
  await switcher.type('checkout')
  await expect(switcher.row(CHECKOUT)).toBeVisible()
  await expect(switcher.row('Main')).toHaveCount(0)
  await expect(switcher.row(POSTGRES)).toHaveCount(0)
  await switcher.type('nothing like this')
  await expect(switcher.root.getByText('No match.')).toBeVisible()

  // ⌘Enter on the first match opens it in a new tab; this tab keeps its topic.
  await switcher.type('checkout')
  await juno.win.keyboard.press('Meta+Enter')
  await juno.tabs.expectCount(2)
  await juno.tabs.expectActive(CHECKOUT)
  await expect(juno.tabs.tab(POSTGRES)).toHaveCount(1)

  // ⌘-click does the same, even for a topic another tab shows.
  const again = await juno.topic.openSwitcher()
  await again.open(POSTGRES, { newTab: true })
  await juno.tabs.expectCount(3)
  await expect(juno.tabs.tab(POSTGRES)).toHaveCount(2)
})

test('⋯ runs Rename: the title becomes a field, and Enter saves the new title', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(RINA).open()
  await juno.topic.expectTitle(RINA)
  await juno.topic.chooseInMenu('rename')
  await juno.rename('Onsite debrief')
  await juno.topic.expectTitle('Onsite debrief')
  await juno.sidebar.row('Onsite debrief').expectVisible()
})
