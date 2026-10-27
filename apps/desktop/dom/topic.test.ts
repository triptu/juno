// Reading a topic (SPEC 6 and 7): prefetch on hover, where it opens, the context pill and a
// #channel chip, Follow new threads in the channel menu, the "N new" divider and the read mark, the topic menu's Notify me, Follow and
// ⌘Z, Main's thread links, the title's topic switcher, and a composer that mounts late or comes back
// taking the keys typed at once.
import type { FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const CHECKOUT = 'checkout.spec failed again on main.'
const ENG_MAIN = '#eng'
const STAGING = 'Unrelated: has anyone looked at the'

// One launch. The hover goes first, while the topic has never been opened; the chip step leaves the sidebar
// scoped to #platform, and Show everything takes that off. The late composer needs threads not opened yet. Rina's thread opens while it still has its 2 unread.
// The Follow step ends with ⌘Z, so the thread is unfollowed again for the Notify me step.
domTest('a topic warms on hover, opens at its "N new" divider, follows and unfollows from its menus, switches from Main, and a late composer takes focus', async ({ juno, slack, fake, app, step }) => {
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

  await step('Follow new threads in the channel menu turns on with a toast, and ⌘Z turns it off', async () => {
    await juno.sidebar.row(POSTGRES).open()
    const followNew = async () => {
      await juno.chooseNextMenuItem(null)
      await juno.topic.contextPill.click({ button: 'right' })
      return (await juno.lastMenu()).labels.find((label) => label.startsWith('Follow new threads'))
    }
    await juno.chooseNextMenuItem('follow-new')
    await juno.topic.contextPill.click({ button: 'right' })
    await juno.expectToast('Following new threads in #eng')
    // The toast shows once the menus' settings show the change.
    expect(await followNew()).toBe('Follow new threads ✓')
    await juno.undo()
    await expect.poll(followNew).toBe('Follow new threads')
  })

  await step('a #channel chip scopes the sidebar to that channel', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.clickChannel('platform')
    await juno.sidebar.expectScope('platform')
    await juno.sidebar.row(POSTGRES).expectAbsent()
  })
  await juno.sidebar.root.getByRole('button', { name: 'Show everything' }).click()

  // The engine's draft replies are held, so each thread's composer mounts only when the test lets it.
  await step('a composer that mounts late takes focus and the keys typed at once after a switcher pick, as does a topic opened again, and leaves focus on the title the user moved to', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await juno.topic.expectTitle('Main')

    // Typed in the same turn as the pick, before the topic lands, and until its composer mounts.
    let release = app.holdReplies('drafts.get')
    let switcher = await juno.topic.openSwitcher()
    await switcher.open(CHECKOUT)
    await juno.win.keyboard.type('on it')
    await juno.topic.expectTitle(CHECKOUT)
    await expect(juno.topic.composer).toHaveCount(0)
    release()
    await expect(juno.topic.composer).toBeFocused()
    await expect(juno.topic.composer).toHaveValue('on it')
    await juno.topic.composer.fill('')

    switcher = await juno.topic.openSwitcher()
    await switcher.open('Main')
    await juno.topic.expectTitle('Main')
    await expect(juno.topic.composer).toBeFocused()
    switcher = await juno.topic.openSwitcher()
    await switcher.open(CHECKOUT)
    await juno.win.keyboard.type('again')
    await expect(juno.topic.composer).toBeFocused()
    await expect(juno.topic.composer).toHaveValue('again')
    await juno.topic.composer.fill('')

    release = app.holdReplies('drafts.get')
    switcher = await juno.topic.openSwitcher()
    await switcher.open(STAGING)
    await juno.topic.expectTitle(STAGING)
    await expect(juno.topic.composer).toHaveCount(0)
    switcher = await juno.topic.openSwitcherWithKeyboard()
    await juno.win.keyboard.press('Escape')
    await expect(switcher.root).toHaveCount(0)
    await expect(juno.topic.titleButton).toBeFocused()
    release()
    await expect(juno.topic.composer).toBeVisible()
    await expect(juno.topic.titleButton).toBeFocused()
  })

  const context: Following = { juno, fake, called: (method, channel) => slack.fake.calls.some((call) => call.method === method && (channel === undefined || call.args['channel'] === channel)) }
  await step('a topic with unread messages opens at the "N new" divider and is marked read', () => openAtDivider(context))
  await step('⋯ opens the topic menu, as a right-click on the title does, and Notify me follows and unfollows the thread', () => notifyMeFromMenus(context))
  await step('an unfollowed thread opened from Main shows Follow in Resolve’s place; a click follows it with Auto, no menu, and ⌘Z undoes it', () => followFromMain(context))
  await step('after Follow, Notify me in ⋯ shows Auto and changes it', () => notifyMeAfterFollow(context))
  await step('Main shows thread links; a link opens the thread in the tab, and the title switches to another thread', () => linksAndSwitcher(juno))
  await step('the switcher searches the channel’s topics, and ⌘ opens one in a new tab', () => searchSwitcher(juno))
})

/** The driver, and whether Slack was called with `method` (in `channel`). */
interface Following {
  readonly juno: Juno
  readonly fake: FakeSlack
  readonly called: (method: string, channel?: string) => boolean
}

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

async function notifyMeFromMenus({ juno, fake, called }: Following): Promise<void> {
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
  expect((await juno.topic.chooseInTitleMenu(null)).labels).toContain('> Never ✓')

  // Always follows it again and it comes back. Slack has not answered yet, and the settings are written after its
  // answer, but a right-click on the title already shows Always checked.
  fake.holdNext({ method: 'subscriptions.thread.add' })
  const every = await juno.topic.chooseInTitleMenu('notify-always')
  expect(every.labels).toContain('Ignore #hiring')
  expect(every.labels).toContain('> Never ✓')
  await rina.expectVisible()
  await expect.poll(() => fake.heldCount({ method: 'subscriptions.thread.add' }), { timeout: 10_000 }).toBe(1)
  expect((await juno.topic.chooseInTitleMenu(null)).labels).toContain('> Always ✓')
  fake.release()
  await expect.poll(() => called('subscriptions.thread.add'), { timeout: 10_000 }).toBe(true)
  await juno.expectToast('Always')
  expect((await juno.topic.chooseInTitleMenu(null)).labels).toContain('> Always ✓')
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
  await main.open()
  await juno.topic.expectTitle('Main')
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
