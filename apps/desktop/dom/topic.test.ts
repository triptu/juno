// Reading a topic (SPEC 6 and 7): prefetch on hover, where it opens, the context pill and a
// #channel chip, the "N new" divider and the read mark, the topic menu's Notify me, Follow and
// ⌘Z, Main's thread links, the title's topic switcher and the header's Tab order.
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const CHECKOUT = 'checkout.spec failed again on main.'
const ENG_MAIN = '#eng'

// The hover goes first, while the topic has never been opened. The chip step moves the scope from #eng, where
// the pill step left it, to #platform.
domTest('a read topic warms on hover, opens from the cache with no divider, and its context pill and a #channel chip scope the sidebar', async ({ juno, slack, step }) => {
  await step('hovering a row warms the topic without asking Slack', async () => {
    slack.resetCalls()
    const warmed = juno.lastMark('juno.prefetch')
    const opened = juno.lastMeasure('juno.topic-open')
    await juno.sidebar.row(POSTGRES).hover()
    await expect.poll(() => juno.lastMark('juno.prefetch')).not.toBe(warmed)
    expect(slack.fake.calls.map((call) => call.method)).toEqual([])
    // The open is a cache hit: the tab paints with its rows.
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectMessage('Booked 2–4pm')
    await expect.poll(() => juno.lastMeasure('juno.topic-open')).not.toBe(opened)
  })

  await step('a read topic opens with no divider', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectMessage('Booked 2–4pm')
    await juno.topic.expectNoDivider()
  })

  await step('the context pill scopes the sidebar to its channel', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.contextPill.click()
    await juno.sidebar.expectScope('eng')
  })

  await step('a #channel chip scopes the sidebar to that channel', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.clickChannel('platform')
    await juno.sidebar.expectScope('platform')
    await juno.sidebar.row(POSTGRES).expectAbsent()
  })
})

/** The driver, and whether Slack was called with `method` (in `channel`). */
interface Following {
  readonly juno: Juno
  readonly called: (method: string, channel?: string) => boolean
}

// Rina’s thread opens first, while it still has its 2 unread. Then checkout’s thread from Main: the Follow step
// ends with ⌘Z, so the thread is unfollowed again for the Notify me step.
domTest('Rina’s thread opens at the "N new" divider and its ⋯ menu unfollows and follows it; Follow on an unfollowed thread from Main, then Notify me after it', async ({ juno, slack, step }) => {
  const context: Following = { juno, called: (method, channel) => slack.fake.calls.some((call) => call.method === method && (channel === undefined || call.args['channel'] === channel)) }
  await step('a topic with unread messages opens at the "N new" divider and is marked read', () => openAtDivider(context))
  await step('⋯ opens the topic menu, as a right-click on the title does, and Notify me follows and unfollows the thread', () => notifyMeFromMenus(context))
  await step('an unfollowed thread opened from Main shows Follow in Resolve’s place; a click follows it with Auto, no menu, and ⌘Z undoes it', () => followFromMain(context))
  await step('after Follow, Notify me in ⋯ shows Auto and changes it', () => notifyMeAfterFollow(context))
})

// The switcher step ends on Main, where the header step starts.
domTest('Main’s thread links, its title switcher, its Notify me and its header order, and the switcher’s search and ⌘ opens', async ({ juno, step }) => {
  await step('Main shows thread links; a link opens the thread in the tab, and the title switches to another thread', () => linksAndSwitcher(juno))
  await step('Main’s Notify me is its channel’s, and the header is reached pill, title, Juno, ⋯', () => headerOrder(juno))
  await step('the switcher searches the channel’s topics, and ⌘ opens one in a new tab', () => searchSwitcher(juno))
})

async function openAtDivider({ juno, called }: Following): Promise<void> {
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
  await expect.poll(() => called('subscriptions.thread.mark'), { timeout: 10_000 }).toBe(true)
}

async function notifyMeFromMenus({ juno, called }: Following): Promise<void> {
  const rina = juno.sidebar.row(RINA)
  await rina.open()
  await juno.topic.expectTitle(RINA)
  await expect(juno.topic.titleButton).toHaveAttribute('aria-haspopup', 'dialog')
  await expect(juno.topic.moreButton).toHaveAttribute('aria-haspopup', 'menu')

  // Never unfollows the thread in Slack, so it leaves the sidebar. The tab stays open on it.
  const never = await juno.topic.chooseInMenu('notify-never')
  // The thread's own menu: Notify me at Auto, the level a follow sets, and its channel's Ignore.
  expect(never.labels).toContain('> Auto ✓')
  expect(never.labels).toContain('Ignore #hiring')
  await rina.expectAbsent()
  await expect.poll(() => called('subscriptions.thread.remove'), { timeout: 10_000 }).toBe(true)

  // Always follows it again, and it comes back; a right-click on the title shows the same menu, with Never checked once the engine has it.
  await expect.poll(async () => (await juno.topic.chooseInTitleMenu(null)).labels).toContain('> Never ✓')
  const every = await juno.topic.chooseInTitleMenu('notify-always')
  expect(every.labels).toContain('Ignore #hiring')
  expect(every.labels).toContain('> Never ✓')
  await rina.expectVisible()
  await expect.poll(() => called('subscriptions.thread.add'), { timeout: 10_000 }).toBe(true)
}

async function followFromMain({ juno, called }: Following): Promise<void> {
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.threadLinkUnder(CHECKOUT).open()
  await juno.topic.expectTitle(CHECKOUT)
  const resolve = juno.topic.header.getByRole('button', { name: 'Resolve', exact: true })
  const checkout = juno.sidebar.row(CHECKOUT)
  await expect(juno.topic.followButton).toBeVisible()
  await expect(juno.topic.followButton).not.toHaveAttribute('aria-haspopup')
  await expect(resolve).toHaveCount(0)
  await checkout.expectAbsent()

  // One click follows it, with no menu: Auto, as Notify me sets it.
  const { menuOpened } = await juno.topic.follow()
  expect(menuOpened).toBe(false)
  await expect.poll(() => called('subscriptions.thread.add', 'C0ENG'), { timeout: 10_000 }).toBe(true)
  await juno.expectToast('Auto')
  await checkout.expectVisible()
  await expect(resolve).toBeVisible()

  // ⌘Z unfollows it again: it leaves the sidebar and the header shows Follow.
  await juno.undo()
  await expect.poll(() => called('subscriptions.thread.remove', 'C0ENG'), { timeout: 10_000 }).toBe(true)
  await checkout.expectAbsent()
  await expect(juno.topic.followButton).toBeVisible()
  await expect(resolve).toHaveCount(0)
}

async function notifyMeAfterFollow({ juno }: Following): Promise<void> {
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.threadLinkUnder(CHECKOUT).open()
  await juno.topic.expectTitle(CHECKOUT)
  expect((await juno.topic.follow()).menuOpened).toBe(false)
  await juno.expectToast('Auto')

  // ⋯ › Notify me has Auto checked; Always replaces it, and the thread stays followed.
  const every = await juno.topic.chooseInMenu('notify-always')
  expect(every.labels).toContain('> Auto ✓')
  await juno.expectToast('Always')
  const after = await juno.topic.chooseInMenu('copy-link')
  expect(after.labels).toContain('> Always ✓')
  await juno.sidebar.row(CHECKOUT).expectVisible()
  await expect(juno.topic.header.getByRole('button', { name: 'Resolve', exact: true })).toBeVisible()
}

async function linksAndSwitcher(juno: Juno): Promise<void> {
  const main = juno.sidebar.row(ENG_MAIN)
  await main.expectNewThreads(1)
  await main.open()
  await juno.topic.expectTitle('Main')
  await expect(juno.topic.contextPill).toHaveAccessibleName('eng, public channel. Show in sidebar.')
  await expect(juno.topic.threadLinkUnder(POSTGRES).root).toBeVisible()

  await juno.topic.threadLinkUnder(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  await juno.tabs.expectCount(1)

  // The switcher: Main first and marked from Main, then the threads; opening an unfollowed thread does not add it to the sidebar.
  await main.open()
  await juno.topic.expectTitle('Main')
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
}

async function headerOrder(juno: Juno): Promise<void> {
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.expectTitle('Main')
  const { labels } = await juno.topic.chooseInMenu('copy-link')
  expect(labels).toContain('> Auto ✓')
  expect(labels).not.toContain('Rename')
  // No huddle runs in #eng, so its header has no huddle control: Start huddle is in ⋯.
  expect(labels).toContain('Start huddle')

  await juno.topic.contextPill.focus()
  const order: string[] = []
  for (let i = 0; i < 4; i++) {
    const active = juno.win.active
    order.push(active?.getAttribute('aria-label') ?? active?.textContent ?? '')
    await juno.win.keyboard.press('Tab')
  }
  expect(order).toEqual(['eng, public channel. Show in sidebar.', 'Main', 'Juno ⌘J', 'More'])
}

async function searchSwitcher(juno: Juno): Promise<void> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)

  // Typing narrows the list to titles whose words start with the query; Main goes, the match stays.
  const switcher = await juno.topic.openSwitcher()
  await switcher.type('checkout')
  await expect(switcher.row(CHECKOUT)).toBeVisible()
  await expect(switcher.row('Main')).toHaveCount(0)
  await expect(switcher.row(POSTGRES)).toHaveCount(0)
  await switcher.type('nothing like this')
  await expect(switcher.row(CHECKOUT)).toHaveCount(0)

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
}
