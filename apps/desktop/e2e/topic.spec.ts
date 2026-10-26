// Reading a topic in the browser. A long thread opens with its divider 80px below the band and older pages load
// without a shift; scrolled up, a reply waits behind "1 new message" and stays unread until Jump to latest; one
// topic in two tabs keeps each tab's scroll; and a notification for a topic open in another tab focuses it, scrolls
// to the message and flashes it. The header's controls answer hover and press, its menus open under their islands,
// Resolve takes Follow's place without moving the title, and menus built on OptionList have one active row under
// the pointer and the arrow keys and open on press. Home and an open topic run no loop at rest. What the topic shows and sends (prefetch, the divider and read
// mark, Notify me, Follow, thread links, the switcher) is in the DOM lane (`dom/topic.test.ts`), and so are live
// messages at the bottom (`dom/live.test.ts`) and which messages notify (`dom/notifications.test.ts`).
import type { Locator, Page } from '@playwright/test'
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { seedWorkspace, startFakeSlack, topic300Seed, TOPIC300_THREAD_CHANNEL, type FakeSlack } from '@juno/fake-slack'
import { watchFlashes } from './driver/flashes'
import type { Juno, Landing } from './driver/juno'
import { expect, syncedTest, test, type Fixtures } from './fixtures'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 90_000 })

const POSTGRES = 'Draft plan is in the doc'
const CHECKOUT = 'checkout.spec failed again on main.'
const ENG_MAIN = '#eng'
const RINA = 'Rina finished the onsite'

syncedTest('Home and a topic are at rest; the header answers hover and press, its menus open under their islands, Resolve takes Follow’s place without moving the title; menus have one active row and open on press', async ({ juno, win }) => {
  // The renderer's share of idle CPU (performance.md section 1): nothing loops on the screens a person leaves open.
  await test.step('Home, then a topic beside the sidebar, run no frame loop, looping animation or timer loop', async () => {
    await juno.home.expectShown()
    await juno.expectAtRest()
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    await juno.expectAtRest()
  })

  await test.step('every control in the header answers hover and press', () => headerFeedback({ juno, win }))

  await test.step('⋯ opens the topic menu at its left edge under the right island; the title’s menu opens at the title’s left edge', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    const more = await juno.topic.chooseInMenu('copy-link')
    const island = (await juno.topic.header.locator('[data-island="right"]').boundingBox())!
    const button = (await juno.topic.moreButton.boundingBox())!
    expect(more.at).not.toBeNull()
    expect(Math.round(more.at!.x)).toBe(Math.round(button.x))
    expect(more.at!.y).toBeGreaterThan(island.y + island.height)
    const titled = await juno.topic.chooseInTitleMenu('copy-link')
    const title = (await juno.topic.titleButton.boundingBox())!
    expect(Math.round(titled.at!.x)).toBe(Math.round(title.x))
  })

  await test.step('Resolve takes Follow’s place at its width, and the title does not move', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await juno.topic.threadLinkUnder(CHECKOUT).open()
    await juno.topic.expectTitle(CHECKOUT)
    const follow = (await juno.topic.followButton.boundingBox())!
    const title = (await juno.topic.titleButton.boundingBox())!
    await juno.topic.follow()
    const resolve = juno.topic.header.getByRole('button', { name: 'Resolve', exact: true })
    await expect(resolve).toBeVisible()
    const swapped = (await resolve.boundingBox())!
    expect(Math.round(swapped.x)).toBe(Math.round(follow.x))
    expect(Math.round(swapped.width)).toBe(Math.round(follow.width))
    expect(await juno.topic.titleButton.boundingBox()).toEqual(title)
  })

  await test.step('the avatar menu has one active item: hover, then the keyboard, then hover again', () => avatarMenuRows(juno, win))
  await test.step('the palette has one active row under the pointer and the arrow keys', () => paletteRows(juno, win))
  await test.step('menu triggers open on mouse down and the release leaves them open', () => pressToOpen(juno, win))
})

/** Frames followed after a scroll ends. */
const FRAMES = 10

/** Every frame from `scrollend` on showed the row it landed on where it landed. */
function expectStill(landing: Landing): void {
  expect(landing.tops.length).toBe(FRAMES)
  expect(landing.tops.filter((top) => Math.abs(top - landing.top) >= 0.5), `row ${landing.ts} must stay at ${landing.top}`).toEqual([])
}

// The topic300 seed beside the default one, which has Rina's thread for the notification's other tab.
const longTest = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({
      seed: (workspace, avatars) => {
        seedWorkspace(workspace, avatars)
        topic300Seed()(workspace, avatars)
      },
    })
    await use(fake)
    await fake.close()
  },
})
const THREAD = 'Review the rollout checklist 1'

longTest('a long thread opens 80px below the band and loads older pages in place; scrolled up a reply waits unread; each of two tabs keeps its scroll; a notification for it focuses its tab, scrolls and flashes', async ({ juno, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await test.step('opens with the first new reply 80px below the header band, and older pages load without moving what is on screen', () => opensAtDivider(juno, slack))
  await test.step('scrolled up, a reply shows "1 new message" and stays unread until Jump to latest', () => scrolledUp(juno, slack))
  await test.step('one topic in two tabs: each tab keeps its own scroll position, and comes back there after messages arrive while it is hidden', () => twoTabs(juno, fake, THREAD))
  await test.step('a notification for a topic open in another tab focuses it, scrolls to the message and flashes it', () => notificationFocuses(juno, slack))
})

async function opensAtDivider(juno: Juno, slack: Fixtures['slack']): Promise<void> {
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
}

// Live messages in an open topic, scrolled up: they wait behind "N new messages" and stay unread until the user
// reaches the bottom. At the bottom they show and count as read (dom/live.test.ts).
async function scrolledUp(juno: Juno, slack: Fixtures['slack']): Promise<void> {
  const row = juno.sidebar.row(THREAD)
  await juno.topic.jumpToLatest()
  await juno.topic.expectAtBottom()
  await row.expectRead()

  await juno.topic.scrollUp(3_000)
  await juno.topic.expectPill('Jump to latest')
  slack.as('Leo').replyIn(THREAD, 'Cutover is on for Friday')
  await juno.topic.expectPill('1 new message')
  await row.expectUnread(1)

  await juno.topic.jumpToLatest()
  await juno.topic.expectAtBottom()
  await juno.topic.expectMessage('Cutover is on for Friday')
  await juno.topic.expectNoPill()
  await row.expectRead()
}

async function notificationFocuses(juno: Juno, slack: Fixtures['slack']): Promise<void> {
  await juno.notificationHoursNow()
  const thread = juno.sidebar.row(`${THREAD}.`)
  await thread.chooseInMenu('notify-always')
  await juno.expectToast(': Always')
  await thread.open()
  await juno.topic.expectAtBottom()
  await juno.topic.scrollToTop()
  await juno.sidebar.row(RINA).openInNewTab()
  await juno.tabs.expectActive(RINA)
  const flashes = await watchFlashes(juno.win)

  slack.as('Leo').replyIn(`${THREAD}.`, 'Cutover is a go')
  await expect.poll(async () => (await juno.osNotifications()).map((notification) => notification.body), { timeout: 15_000 }).toContain('Cutover is a go')
  const shown = (await juno.osNotifications()).findIndex((notification) => notification.body === 'Cutover is a go')
  await juno.clickOsNotification(shown)

  await juno.tabs.expectActive(THREAD)
  const reply = juno.topic.message('Cutover is a go')
  await expect(reply).toBeInViewport({ ratio: 1 })
  await expect.poll(flashes).toContainEqual(expect.stringContaining('Cutover is a go'))
  // Back to the other tab and here again: the request was taken once, so nothing flashes again.
  const before = (await flashes()).length
  await juno.tabs.select(RINA)
  await juno.tabs.select(THREAD)
  await juno.topic.expectMessage('Cutover is a go')
  expect(await flashes()).toHaveLength(before)
}

/**
 * The thread open in a second tab, both at the bottom; the second scrolled up comes back where it was, after the
 * first followed three new replies and dropped as many rows from its window's top.
 */
async function twoTabs(juno: Juno, fake: FakeSlack, thread: string): Promise<void> {
  const { sidebar, tabs, topic } = juno
  // ⌘-click opens the topic again in a new tab, though a tab shows it.
  await sidebar.row(thread).openInNewTab()
  await expect(tabs.tab(thread)).toHaveCount(2)
  await tabs.expectActiveAt(thread, 1)
  await topic.expectAtBottom()

  // The wheel jumps onto rows still at their size estimate; they reach their real height without moving the row in view.
  const up = await topic.scrollUp(2400, FRAMES)
  expectStill(up)

  // The first tab is still at the bottom; the second is where it was left.
  await tabs.selectAt(thread, 0)
  await tabs.expectActiveAt(thread, 0)
  await topic.expectAtBottom()
  await tabs.selectAt(thread, 1)
  await tabs.expectActiveAt(thread, 1)
  // The row that was first in view is back where it was. Which row counts as first can flip on a
  // sub-pixel when a row edge sits on the list's top, so the same row is followed instead.
  expect(await topic.rowTop(up.ts)).toBeCloseTo(up.top, 0)

  // The first tab follows three new replies at the bottom, and the window drops as many rows from its top; then the
  // second tab comes back with the row where it was, in its first frame and every frame after.
  await tabs.selectAt(thread, 0)
  await tabs.expectActiveAt(thread, 0)
  const threadTs = fake.workspace.main(TOPIC300_THREAD_CHANNEL).find((message) => message.text?.startsWith(thread))!.ts
  for (const n of [1, 2, 3]) fake.injectMessage({ channel: TOPIC300_THREAD_CHANNEL, user: 'U0PERFLEO', threadTs, text: `A reply while the other tab is hidden 1.${n}` })
  await topic.expectMessage('A reply while the other tab is hidden 1.3')
  await topic.expectAtBottom()
  await expectStableAnchor(juno.win, `[data-message-row="${up.ts}"]`, async () => {
    await tabs.selectAt(thread, 1)
    await tabs.expectActiveAt(thread, 1)
    expect(await topic.rowTop(up.ts)).toBeCloseTo(up.top, 0)
    await topic.expectPill('3 new messages')
  })

  // A plain open focuses the tab that was active last, without moving it.
  await tabs.selectAt(thread, 0)
  await sidebar.row(thread).open()
  await tabs.expectActiveAt(thread, 0)
  await topic.expectAtBottom()
  await expect(tabs.tab(thread)).toHaveCount(2)
}

async function headerFeedback({ juno, win }: Pick<Fixtures, 'juno' | 'win'>): Promise<void> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const header = juno.topic.header
  const controls = [
    header.locator('button[aria-label="Resolve"]'),
    juno.topic.titleButton,
    header.locator('button[aria-label*="Show in sidebar"]'),
    header.locator('button[aria-label="Juno ⌘J"]'),
    juno.topic.moreButton,
  ]
  const look = (control: (typeof controls)[number]) =>
    control.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, scale: style.scale }
    })
  const away = () => win.mouse.move(5, 300)

  for (const control of controls) {
    // Every control is there: a removed one fails.
    await expect(control).toBeVisible()
    const name = (await control.getAttribute('aria-label')) ?? (await control.textContent())
    await away()
    const rest = await look(control)
    await control.hover()
    await expect.poll(async () => (await look(control)).background, { message: `hover on ${name}` }).not.toBe(rest.background)
    // Menu triggers open on press; capture them instead of leaving a native menu open.
    await juno.chooseNextMenuItem(null)
    await win.mouse.down()
    await expect.poll(async () => (await look(control)).background, { message: `press on ${name}` }).not.toBe(rest.background)
    expect((await look(control)).scale).toBe(rest.scale)
    // Release away so buttons that act on click do not run.
    await away()
    await win.mouse.up()
  }
}

// Menus and lists built on OptionList have one active row, as a native menu does: the pointer and the arrow keys
// move the same highlight, and no row keeps a hover highlight of its own beside it.
/** The names of the rows drawn highlighted: any row with a background. */
function highlighted(list: Locator): Promise<string[]> {
  return list.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"]')]
      .filter((row) => getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)')
      .map((row) => row.textContent ?? ''),
  )
}

async function avatarMenuRows(juno: Juno, win: Page): Promise<void> {
  const { accountMenu } = juno
  await accountMenu.open()
  // The menu opens centred under the avatar (inventory 2.1), not off to its left.
  const avatar = await win.locator('aside [aria-label="Account and settings"]').boundingBox()
  const menu = await accountMenu.root.boundingBox()
  expect(Math.abs(menu!.x + menu!.width / 2 - (avatar!.x + avatar!.width / 2))).toBeLessThanOrEqual(1)
  expect(menu!.y).toBeGreaterThan(avatar!.y + avatar!.height)
  const list = accountMenu.root.locator('[role="menu"][aria-label="Account"]')
  const notifications = accountMenu.item(/^Notifications/)

  await notifications.hover()
  await expect.poll(() => highlighted(list)).toEqual([expect.stringMatching(/^Notifications/)])
  await expect(list).toHaveAttribute('aria-activedescendant', (await notifications.getAttribute('id')) ?? '')

  // The keyboard goes on from the hovered item while the pointer rests on it.
  await win.keyboard.press('Tab')
  await expect(list).toBeFocused()
  await win.keyboard.press('ArrowUp')
  await expect.poll(() => highlighted(list)).toEqual([expect.stringMatching(/^Hide message text/)])

  await accountMenu.item(/^Set yourself/).hover()
  await expect.poll(() => highlighted(list)).toEqual([expect.stringMatching(/^Set yourself/)])
  await win.keyboard.press('ArrowDown')
  await expect.poll(() => highlighted(list)).toEqual([expect.stringMatching(/^Hide message text/)])

  // Leaving the menu clears the highlight, as a native menu does.
  await accountMenu.root.getByRole('heading', { name: 'Session' }).hover()
  await expect.poll(() => highlighted(list)).toEqual([])
  await accountMenu.close()
}

async function paletteRows(juno: Juno, win: Page): Promise<void> {
  const { palette } = juno
  await palette.open()
  const list = palette.root.locator('[role="listbox"][aria-label="Results"]')
  const rows = list.getByRole('option')
  await expect(rows.nth(2)).toBeVisible()

  await rows.nth(2).hover()
  await expect.poll(async () => (await highlighted(list)).length).toBe(1)
  const hovered = await rows.nth(2).textContent()
  expect(await highlighted(list)).toEqual([hovered])

  await win.keyboard.press('ArrowDown')
  const next = await rows.nth(3).textContent()
  await expect.poll(() => highlighted(list)).toEqual([next])

  await rows.nth(1).hover()
  await expect.poll(async () => highlighted(list)).toEqual([await rows.nth(1).textContent()])
  await win.keyboard.press('Escape')
  await palette.expectClosed()
}

async function pressToOpen(juno: Juno, win: Page): Promise<void> {
  const press = async (trigger: Locator) => {
    const box = (await trigger.boundingBox())!
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await win.mouse.down()
  }
  const account = juno.sidebar.accountButton
  await press(account)
  await expect(juno.accountMenu.root).toBeVisible()
  await win.mouse.up()
  await expect(juno.accountMenu.root).toBeVisible()
  await expect(account).toHaveAttribute('aria-expanded', 'true')
  // A second press toggles closed; its click must not reopen it.
  await press(account)
  await expect(juno.accountMenu.root).toHaveCount(0)
  await win.mouse.up()
  await expect(juno.accountMenu.root).toHaveCount(0)
  await account.click()
  await expect(juno.accountMenu.root).toBeVisible()
  await win.keyboard.press('Escape')

  await juno.sidebar.row('#eng').open()
  const switcher = win.getByRole('dialog', { name: 'Topics in this channel' })
  await press(juno.topic.titleButton)
  await expect(switcher).toBeVisible()
  await expect(switcher.getByRole('textbox', { name: 'Search this channel' })).toBeFocused()
  await win.mouse.up()
  await expect(switcher).toBeVisible()
  await juno.topic.expectTitle('Main')
  await press(juno.topic.titleButton)
  await expect(switcher).toHaveCount(0)
  await win.mouse.up()
  await expect(switcher).toHaveCount(0)
  // Custom popovers need a separate press to choose an item: releasing over one is harmless.
  await press(juno.topic.titleButton)
  await expect(switcher).toBeVisible()
  await switcher.getByRole('option').nth(1).hover()
  await win.mouse.up()
  await expect(switcher).toBeVisible()
  await juno.topic.expectTitle('Main')
  await win.keyboard.press('Escape')
  // Enter, Space, ↓ and AT's detail=0 click still open from focus.
  for (const key of ['Enter', 'Space', 'ArrowDown']) {
    await juno.topic.titleButton.focus()
    await win.keyboard.press(key)
    await expect(switcher).toBeVisible()
    await win.keyboard.press('Escape')
  }
  await juno.topic.titleButton.evaluate((button: HTMLButtonElement) => button.click())
  await expect(switcher).toBeVisible()
  await win.keyboard.press('Escape')
  await juno.topic.titleButton.click()
  await expect(switcher).toBeVisible()
  await win.keyboard.press('Escape')

  // Native Electron menus use the existing held-menu seam: opening is observable before release.
  await juno.chooseNextMenuItem(null, { hold: true })
  const before = await juno.menusAsked()
  await press(juno.topic.moreButton)
  await expect(juno.topic.moreButton).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => juno.menusAsked()).toBe(before + 1)
  expect((await juno.lastMenu()).labels).toContain('Copy Slack link')
  await win.mouse.up()
  await expect(juno.topic.moreButton).toHaveAttribute('aria-expanded', 'true')
  expect(await juno.menusAsked()).toBe(before + 1)
  await juno.topic.expectTitle('Main')
  await juno.releaseMenu()
  await expect(juno.topic.moreButton).toHaveAttribute('aria-expanded', 'false')
}
