import type { Locator } from '@playwright/test'
import { expect, hooks, test } from './fixtures'
import { JunoChatPane, test as chatTest } from './juno-agent/chat'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 60_000, mode: 'parallel' })

const POSTGRES = 'Draft plan is in the doc'

/** The edge a growing last row keeps: its bottom when the list scrolls and holds its end, its top when the list fits the view. */
const growingEdge = async (list: Locator): Promise<'top' | 'bottom'> =>
  (await list.evaluate((node) => {
    const scroller = node.closest('[data-scroll-area]')!
    return scroller.scrollHeight > scroller.clientHeight + 1
  }))
    ? 'bottom'
    : 'top'
const RINA = 'Rina finished the onsite'

for (const path of ['topic bottom', 'topic divider', 'Main with threads', 'DM', 'Home', 'All topics', 'Juno'] as const) {
  test(`stable open: ${path}`, async ({ juno, win, fake }) => {
    await juno.signIn()
    await juno.waitForSync()
    fake.holdNext({ method: 'conversations.replies', reason: 'open' })
    fake.holdNext({ method: 'conversations.history', reason: 'open' })
    if (path === 'Home') await juno.sidebar.row(POSTGRES).open()
    const selector = path === 'Home' ? '[data-home-item]' : path === 'All topics' ? '[data-all-topics-row]' : path === 'Juno' ? '[data-juno-header]' : '[data-topic-view] [data-message-row]'
    await expectStableAnchor(win, selector, async () => {
      switch (path) {
        case 'Home':
          await juno.home.open()
          break
        case 'All topics':
          await juno.allTopics.open()
          break
        case 'Juno':
          await win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
          await win.locator('[data-juno-header]').waitFor({ state: 'visible' })
          break
        default:
          if (path === 'DM') await win.locator('[data-topic-id="m:D0MAYA"]').click()
          else await juno.sidebar.row(path === 'topic bottom' ? POSTGRES : path === 'topic divider' ? RINA : '#eng').open()
          await expect(juno.topic.header).toBeVisible()
      }
      if (path.startsWith('topic') || path === 'DM' || path === 'Main with threads') await expect.poll(() => fake.heldCount()).toBeGreaterThan(0)
      fake.release()
      if (path.startsWith('topic') || path === 'DM' || path === 'Main with threads') await expect(juno.topic.list.locator('[data-message-row]').first()).toBeVisible()
      await win.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    })
  })
}

// No line is held for reactions a message does not have yet (SPEC 7, "Stable geometry"). The last message's first
// chip grows it in one step: in a list that fits the view, downwards; at the bottom of a longer one, the list keeps
// its end and the rows above lift in the same frame, as Slack's do.
test('a late reaction on the last message grows it without a jump', async ({ juno, win, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  const row = juno.topic.list.locator('[data-message-row]').last()
  const ts = await row.getAttribute('data-message-row')
  expect(ts).not.toBeNull()
  const selector = `[data-message-row="${ts}"]`
  const edge = await growingEdge(juno.topic.list)
  await expectStableAnchor(win, selector, async () => {
    fake.addReaction({ channel: slack.root(POSTGRES).channel, ts: ts!, name: 'eyes', user: slack.as('Leo').id })
    await expect(row.getByRole('list', { name: 'Reactions' })).toBeVisible()
  }, { edge })
})

// What must never move: the rows in view when something changes above them, and the list's end while it is held.
test('a late reaction above the view moves no row in view, and one on the last message keeps the bottom', async ({ juno, win, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const channel = slack.channel('eng')
  const user = slack.as('Leo').id
  const root = fake.injectMessage({ channel, user, text: 'Reaction above the view check' })
  const replies = Array.from({ length: 30 }, (_, i) => fake.workspace.post({ channel, user: i % 2 === 0 ? user : slack.as('Maya').id, threadTs: root.ts, text: `Reply ${i}`, silent: true }))
  const latest = fake.injectMessage({ channel, user, threadTs: root.ts, text: 'Latest reply under the view check' })
  await juno.sidebar.row('#eng').open()
  await juno.topic.list.locator(`[data-thread-link="t:${channel}:${root.ts}"]`).click()
  await juno.topic.expectMessage('Latest reply under the view check')
  const above = juno.topic.list.locator(`[data-message-row="${replies[1]!.ts}"]`)
  expect(await above.evaluate((node) => node.getBoundingClientRect().bottom < (node.closest('[data-scroll-area]')?.getBoundingClientRect().top ?? 0))).toBe(true)
  await expectStableAnchor(win, `[data-message-row="${latest.ts}"]`, async () => {
    fake.addReaction({ channel, ts: replies[1]!.ts, name: 'eyes', user })
    await expect(above.getByRole('list', { name: 'Reactions' })).toBeAttached()
  })
  expect(await growingEdge(juno.topic.list)).toBe('bottom')
  const last = juno.topic.list.locator(`[data-message-row="${latest.ts}"]`)
  await expectStableAnchor(win, `[data-message-row="${latest.ts}"]`, async () => {
    fake.addReaction({ channel, ts: latest.ts, name: 'eyes', user })
    await expect(last.getByRole('list', { name: 'Reactions' })).toBeVisible()
  }, { edge: 'bottom' })
})

for (const divider of [false, true]) {
  test(`partial thread waits for history at ${divider ? 'divider' : 'bottom'}`, async ({ juno, win, slack, fake }) => {
    await juno.signIn()
    await juno.waitForSync()
    const channel = slack.channel('eng')
    const user = slack.as('Leo').id
    const root = fake.injectMessage({ channel, user, text: 'Delayed history layout check' })
    const replies = Array.from({ length: 30 }, (_, i) => fake.workspace.post({ channel, user, threadTs: root.ts, text: `Earlier reply ${i}`, silent: true }))
    const latest = fake.injectMessage({ channel, user, threadTs: root.ts, text: 'Latest delayed reply' })
    if (divider) fake.markThreadRead({ channel, threadTs: root.ts, ts: replies[24]!.ts })
    await juno.sidebar.row('#eng').open()
    const link = juno.topic.list.locator(`[data-thread-link="t:${channel}:${root.ts}"]`)
    await expect(link).toBeVisible()
    fake.holdNext({ method: 'conversations.replies', reason: 'open' })
    await link.click()
    await expect.poll(() => fake.heldCount({ method: 'conversations.replies' })).toBe(1)
    await expect(juno.topic.list.locator('[data-message-row]')).toHaveCount(0)
    await expectStableAnchor(win, divider ? '[data-new-divider]' : `[data-message-row="${latest.ts}"]`, async () => {
      fake.release({ method: 'conversations.replies' })
      await juno.topic.expectMessage('Latest delayed reply')
      await expect(juno.topic.list.locator('[data-message-row]')).toHaveCount(32)
    })
  })
}

// The time follows the name, so a name that resolves late moves the time along its line once; the message stays put.
test('a sender name resolves without moving the message', async ({ juno, win, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const person = { ...fake.workspace.users.get(slack.as('Leo').id)!, id: 'U0LATE', name: 'late', profile: { display_name: 'Leonard Alexander Park', real_name: 'Leonard Alexander Park' } }
  fake.workspace.users.set(person.id, person)
  fake.holdNext({ method: 'edge:users/info' })
  const message = fake.injectMessage({ channel: slack.channel('eng'), user: person.id, text: 'A message before its sender resolves' })
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectMessage('A message before its sender resolves')
  await expect.poll(() => fake.heldCount({ method: 'edge:users/info' })).toBe(1)
  await expectStableAnchor(win, `[data-message-row="${message.ts}"] [data-msg-text]`, async () => {
    fake.release({ method: 'edge:users/info' })
    await expect(juno.topic.list.getByText('Leonard Alexander Park', { exact: true }).first()).toBeVisible()
  })
})

test('a new Main message gains a thread link without a jump, and the header stays put', async ({ juno, win, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const channel = slack.channel('deploys')
  const user = slack.as('Leo').id
  const root = fake.injectMessage({ channel, user, text: 'A new Main message for the thread slot' })
  await win.getByRole('button', { name: 'Automated', exact: true }).click()
  await juno.sidebar.row('#deploys').open()
  await juno.topic.expectMessage('A new Main message for the thread slot')
  // Main's threads are behind the title's switcher now; the right island (⋯ and Juno) must not move either.
  const island = juno.topic.header.locator('[data-island="right"]')
  const islandBefore = await island.boundingBox()
  const edge = await growingEdge(juno.topic.list)
  await expectStableAnchor(win, `[data-message-row="${root.ts}"]`, async () => {
    fake.injectMessage({ channel, user, threadTs: root.ts, text: 'A reply arriving after Main paints' })
    await expect(juno.topic.list.locator(`[data-thread-link="t:${channel}:${root.ts}"]`)).toBeVisible()
    expect(await island.boundingBox()).toEqual(islandBefore)
  }, { edge })
  // The new thread is in the switcher.
  const switcher = await juno.topic.openSwitcher()
  await expect(switcher.row('A new Main message')).toBeVisible()
})

test('delayed image bytes keep the reserved thumbnail box', async ({ juno, win, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  fake.holdNext({ method: 'file:bytes', times: 100 })
  await juno.sidebar.row('Proposal: cut offline mode').open()
  const image = juno.topic.list.locator('[data-thumbnail] img').last()
  await expect(image).toBeVisible()
  await expect.poll(() => fake.heldCount({ method: 'file:bytes' })).toBeGreaterThan(0)
  expect(await image.evaluate((node) => node instanceof HTMLImageElement && node.complete)).toBe(false)
  await expectStableAnchor(win, '[data-thumbnail]', async () => {
    fake.release({ method: 'file:bytes' })
    await expect.poll(() => image.evaluate((node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true)
  })
})


test('sidebar rows stay fixed while sync fills the remaining topics', async ({ juno, win, fake }) => {
  fake.holdNext({ method: 'subscriptions.thread.getView' })
  await juno.signIn()
  await expect.poll(() => fake.heldCount({ method: 'subscriptions.thread.getView' })).toBe(1)
  // A launch opens a New chat tab; Home, which this waits on, is one click away.
  await juno.home.navItem.click()
  await expect(win.locator('[data-topic-row]')).toHaveCount(0)
  await expectStableAnchor(win, '[data-topic-row]', async () => {
    fake.release({ method: 'subscriptions.thread.getView' })
    await juno.home.expectShown()
    await expect(win.locator('[data-topic-row]').first()).toBeVisible()
  })
})


for (const destination of ['Home', 'All topics'] as const) {
  test(`cold sync fills ${destination} without moving painted rows`, async ({ juno, win, fake }) => {
    fake.holdNext({ method: 'subscriptions.thread.getView' })
    await juno.signIn()
    await expect.poll(() => fake.heldCount({ method: 'subscriptions.thread.getView' })).toBe(1)
    // A launch opens a New chat tab: open the page under test from the sidebar.
    if (destination === 'All topics') await juno.allTopics.open()
    else await juno.home.navItem.click()
    const selector = destination === 'Home' ? '[data-home-item]' : '[data-all-topics-row]'
    await expect(win.locator(selector)).toHaveCount(0)
    const anchor = destination === 'Home' ? '[data-home-scene]' : selector
    await expectStableAnchor(win, anchor, async () => {
      fake.release({ method: 'subscriptions.thread.getView' })
      await expect(win.locator('[data-topic-row]').first()).toBeVisible()
      await expect(win.locator(selector).first()).toBeVisible()
    })
  })
}

test('Home rows painted during the first sync stay fixed as later history pages land', async ({ juno, win, fake }) => {
  const method = 'conversations.history'
  fake.holdNext({ method })
  await juno.signIn()
  // A launch opens a New chat tab; open Home from the sidebar while the sync runs.
  await juno.home.navItem.click()
  const syncing = win.locator('[data-home][data-home-loading]')
  // Let pages land one at a time until Home paints a row while the sync still runs.
  await expect
    .poll(
      async () => {
        if ((await syncing.locator('[data-home-item]').count()) > 0) return true
        if (fake.heldCount({ method }) > 0) {
          fake.release({ method })
          fake.holdNext({ method })
        }
        return false
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  await expect.poll(() => fake.heldCount({ method })).toBe(1)
  const boxes = () => win.locator('[data-home-item]').evaluateAll((rows) => rows.map((row) => ({ id: row.getAttribute('data-home-item'), ...row.getBoundingClientRect().toJSON() })))
  const painted = await boxes()
  // The latest-reply fetch comes after every history page: holding it keeps the sync open while the probe watches
  // the pages land, so the sidebar's progress line leaving at the end is not part of it.
  fake.holdNext({ method: 'conversations.replies', times: 1000 })
  await expectStableAnchor(win, '[data-home-item]', async () => {
    fake.release({ method })
    await expect.poll(() => fake.heldCount({ method: 'conversations.replies' }), { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(syncing).toBeVisible()
  })
  expect((await boxes()).slice(0, painted.length)).toEqual(painted)
  // The sync ends: the rows painted are still where they were.
  fake.release({ method: 'conversations.replies' })
  await expect(win.locator('[data-home]:not([data-home-loading])')).toBeVisible({ timeout: 30_000 })
  expect((await boxes()).slice(0, painted.length)).toEqual(painted)
})

test('the probe rejects a one-pixel movement that returns before the action ends', async ({ win }) => {
  await win.setContent('<div id="anchor">Anchor</div>')
  await expect(expectStableAnchor(win, '#anchor', async () => {
    await win.evaluate(async () => {
      const anchor = document.getElementById('anchor')!
      anchor.style.transform = 'translateY(1px)'
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      anchor.style.transform = ''
    })
  })).rejects.toThrow('anchor must move by exactly 0 px')
})

chatTest('a Juno response leaves the owner bubble where it first painted', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  await expect.poll(() => hooks(juno.app, 'agentState'), { timeout: 15_000 }).toBe('ready')
  await win.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: /^Juno/ }).click()
  const chat = JunoChatPane.tab(win)
  await chat.composer.fill('Check the layout of this reply')
  await expectStableAnchor(win, '[data-chat-owner]', async () => {
    await chat.composer.press('Enter')
    await chat.expectJuno('You said: Check the layout of this reply')
  })
})
