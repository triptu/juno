import type { Locator } from '@playwright/test'
import { expect, syncedTest, test } from './fixtures'
import { expectHomeSyncFrames } from './homeSyncProbe'
import { messageStored } from './driver/userDb'
import { expectStableAnchor } from './shiftProbe'

// A failing test attaches the sidebar's order hold and topic list values (README, "Sidebar trace").
test.use({ sidebarTrace: true })

test.describe.configure({ mode: 'parallel' })

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
const QUIET = 'Lag alerts are firing on the'

// Each path opens a topic or page this test has not opened before, from Home as at launch, so the first message row
// the probe finds is the new topic's. The Home path opens the topic it leaves from first.
syncedTest('topics and pages open without a layout shift, and a row on All topics opens its topic', async ({ juno, win, fake }) => {
  for (const [index, path] of (['topic bottom', 'topic divider', 'Main with threads', 'DM', 'Home', 'All topics', 'Juno'] as const).entries()) {
    await test.step(`stable open: ${path}`, async () => {
      if (index > 0) await juno.home.open()
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
        // Lets the held calls go and forgets both rules, so nothing is held in the next step.
        fake.release()
        if (path.startsWith('topic') || path === 'DM' || path === 'Main with threads') await expect(juno.topic.list.locator('[data-message-row]').first()).toBeVisible()
        await win.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      })
    })
  }

  // What each filter keeps is the engine's all-topics flow test; this checks a row opens what the sidebar leaves out.
  await test.step('a quiet topic on All topics opens in the same tab, and Back returns to the page', async () => {
    const { allTopics, tabs } = juno
    await juno.sidebar.row(QUIET).expectAbsent()
    await allTopics.open()
    await allTopics.row(QUIET).expectStatus('Quiet')
    await allTopics.row(QUIET).open()
    await juno.topic.expectTitle(/Lag alerts are firing on the/)
    await tabs.expectCount(1)
    await juno.nav.back()
    await tabs.expectActive('All topics')
    await allTopics.row(QUIET).expectVisible()
  })
})

// No line is held for reactions a message does not have yet (SPEC 7, "Stable geometry"). The last message's first
// chip grows it in one step: in a list that fits the view, downwards; at the bottom of a longer one, the list keeps
// its end and the rows above lift in the same frame, as Slack's do.
// What must never move: the list's end while it is held, and the rows in view when something changes above them
// while the user reads further up. Then two late changes in Main: a sender name that resolves after the message
// paints, and a reply that gives a new message its thread link.
syncedTest('late changes move nothing in view: a reaction on the last message or above a scrolled list, a sender name, a new thread link', async ({ juno, win, slack, fake }) => {
  await test.step('a late reaction on the last message keeps the bottom, and one above the view moves no row in view', async () => {
    const channel = slack.channel('eng')
    const user = slack.as('Leo').id
    const root = fake.injectMessage({ channel, user, text: 'Reaction above the view check' })
    for (let i = 0; i < 30; i++) fake.workspace.post({ channel, user: i % 2 === 0 ? user : slack.as('Maya').id, threadTs: root.ts, text: `Reply ${i}`, silent: true })
    const latest = fake.injectMessage({ channel, user, threadTs: root.ts, text: 'Latest reply under the view check' })
    await juno.sidebar.expectTop('#eng')
    await juno.sidebar.row('#eng').open()
    await juno.topic.list.locator(`[data-thread-link="t:${channel}:${root.ts}"]`).click()
    await juno.topic.expectMessage('Latest reply under the view check')
    // Juno heard only the root and the latest live; the 30 replies come with the thread's history.
    await expect(juno.topic.list.locator('[data-message-row]')).toHaveCount(32)
    expect(await growingEdge(juno.topic.list)).toBe('bottom')
    const last = juno.topic.list.locator(`[data-message-row="${latest.ts}"]`)
    await expectStableAnchor(win, `[data-message-row="${latest.ts}"]`, async () => {
      fake.addReaction({ channel, ts: latest.ts, name: 'eyes', user })
      await expect(last.getByRole('list', { name: 'Reactions' })).toBeVisible()
    }, { edge: 'bottom' })
    // Away from the bottom nothing holds the end, so this is the hold on the row in view and scroll anchoring. The
    // row two above the first one in view is off screen but laid out, so its chips change the list's height.
    const { ts } = await juno.topic.scrollUp(400)
    const above = await juno.topic.list.evaluate((list, ts) => {
      const rows = [...list.querySelectorAll<HTMLElement>('[data-message-row]')]
      return rows[rows.findIndex((row) => row.dataset['messageRow'] === ts) - 2]!.dataset['messageRow']!
    }, ts)
    const row = juno.topic.list.locator(`[data-message-row="${above}"]`)
    expect(await row.evaluate((node) => node.getBoundingClientRect().bottom < node.closest('[data-scroll-area]')!.getBoundingClientRect().top && node.firstElementChild!.checkVisibility({ contentVisibilityAuto: true }))).toBe(true)
    await expectStableAnchor(win, `[data-message-row="${ts}"]`, async () => {
      fake.addReaction({ channel, ts: above, name: 'eyes', user })
      await expect(row.getByRole('list', { name: 'Reactions' })).toBeAttached()
    })
  })

  // Until users.info answers, the sender is a stand-in named "Someone", so the name line is there from the first paint.
  // The time follows the name, so a name that resolves late moves the time along its line once; the message stays put.
  await test.step('a sender name resolves without moving the message', async () => {
    const person = { ...fake.workspace.users.get(slack.as('Leo').id)!, id: 'U0LATE', name: 'late', profile: { display_name: 'Leonard Alexander Park', real_name: 'Leonard Alexander Park' } }
    fake.workspace.users.set(person.id, person)
    fake.holdNext({ method: 'edge:users/info' })
    const message = fake.injectMessage({ channel: slack.channel('eng'), user: person.id, text: 'A message before its sender resolves' })
    await juno.sidebar.expectTop('#eng')
    await juno.sidebar.row('#eng').open()
    await juno.topic.expectMessage('A message before its sender resolves')
    await expect.poll(() => fake.heldCount({ method: 'edge:users/info' })).toBe(1)
    await expectStableAnchor(win, `[data-message-row="${message.ts}"] [data-msg-text]`, async () => {
      fake.release({ method: 'edge:users/info' })
      await expect(juno.topic.list.getByText('Leonard Alexander Park', { exact: true }).first()).toBeVisible()
    })
  })

  await test.step('a new Main message gains a thread link without a jump, and the header stays put', async () => {
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
})

// A thread no page proves, with 30 replies Juno never stored and the latest it heard live. At the bottom the
// latest paints at once, at the foot of the list, and the 30 come in above it without moving its text. At the
// "N new" divider the list waits for them, since the topic opens at the divider, which belongs among them.
syncedTest('a partial thread paints what it holds at the bottom and grows above it, and at its divider waits for history', async ({ juno, win, slack, fake, userData }) => {
  for (const divider of [false, true]) {
    await test.step(divider ? 'at the divider it waits for history' : 'at the bottom it paints what it holds and grows above it', async () => {
      const channel = slack.channel('eng')
      const user = slack.as('Leo').id
      const title = divider ? 'Delayed history divider check' : 'Delayed history layout check'
      // The root is not posted live: a root heard on this connection proves its thread from the root (`liveRoots`),
      // so silent replies under it would not make a partial thread. Main's open fetch brings it instead.
      const root = fake.workspace.post({ channel, user, text: title, silent: true })
      const replies = Array.from({ length: 30 }, (_, i) => fake.workspace.post({ channel, user, threadTs: root.ts, text: `Earlier reply ${i}`, silent: true }))
      const latest = fake.injectMessage({ channel, user, threadTs: root.ts, text: 'Latest delayed reply' })
      if (divider) fake.markThreadRead({ channel, threadTs: root.ts, ts: replies[24]!.ts })
      // The read mark makes the thread a row; open #eng once it is there.
      if (divider) await juno.sidebar.expectTop(title)
      await juno.sidebar.row('#eng').open()
      const link = juno.topic.list.locator(`[data-thread-link="t:${channel}:${root.ts}"]`)
      await expect(link).toBeVisible()
      // The live reply is stored before the open, so the thread holds it when it opens.
      await expect.poll(() => messageStored(userData, fake.teamId, channel, latest.ts)).toBe(true)
      fake.holdNext({ method: 'conversations.replies', reason: 'open' })
      await link.click()
      await expect.poll(() => fake.heldCount({ method: 'conversations.replies' })).toBe(1)
      const rows = juno.topic.list.locator('[data-message-row]')
      await expect(rows).toHaveCount(divider ? 0 : 1)
      // The same sender's replies above it take the latest into their group, so its name line goes; its text stays.
      // Chromium reports the row's top edge moving down as a shift; it skips that only within 500 ms of the click, and
      // under load the replies render later. The text is the anchor, so the samples check it stays to the pixel.
      const latestRow = `[data-message-row="${latest.ts}"]`
      await expectStableAnchor(win, divider ? '[data-new-divider]' : `${latestRow} [data-msg-text]`, async () => {
        fake.release({ method: 'conversations.replies' })
        await juno.topic.expectMessage('Earlier reply 0')
        await expect(rows).toHaveCount(32)
      }, divider ? {} : { outside: latestRow })
    })
  }
})

// The quick start paints rows before history lands, and a clear bot channel leaves for Automated when its history
// does (decision 10-16 16:56, sidebar-first-sync.spec.ts): #alerts-prod and #deploys were in 2 of 20
// first paints at 16 workers, and left 150 to 330 ms later. Once they have left, the rest of the sync fills in the
// remaining topics below and the card at the foot goes, and no row on screen moves.
test('sidebar rows stay fixed while sync fills the remaining topics', { tag: ['@heavy', '@heavy-sync'] }, async ({ juno, win, fake }) => {
  fake.holdNext({ method: 'subscriptions.thread.getView' })
  await juno.signIn()
  await expect.poll(() => fake.heldCount({ method: 'subscriptions.thread.getView' })).toBe(1)
  // A launch opens Home; its sidebar item opens it afresh, which this waits on.
  await juno.home.navItem.click()
  await expect(win.locator('[data-topic-row]')).toHaveCount(0)
  fake.release({ method: 'subscriptions.thread.getView' })
  await juno.home.expectShown()
  await juno.sidebar.expectRows()
  await expect(win.getByRole('button', { name: 'Automated', exact: true })).toBeVisible()
  for (const bot of ['#alerts-prod', '#deploys']) await expect(juno.sidebar.row(bot, { exact: true }).root).toHaveCount(0)
  await expectStableAnchor(win, '[data-topic-row]', async () => {
    await juno.expectEngineLive()
    await juno.sidebar.expectNoSyncStatus()
  })
})

test('cold sync fills Home with retained rows, a fixed composer and no flicker', { tag: ['@heavy', '@heavy-sync'] }, async ({ juno, win, fake }) => {
  const method = 'conversations.history'
  const subscriptions = 'subscriptions.thread.getView'
  fake.holdNext({ method: subscriptions })
  fake.holdNext({ method })
  // Previews run beside history, so hold them before any history page can land.
  fake.holdNext({ method: 'conversations.replies', reason: 'thread-preview', times: 1000 })
  await juno.signIn()
  await expect.poll(() => fake.heldCount({ method: subscriptions })).toBe(1)
  // Open Home from the sidebar while the sync runs.
  await juno.home.navItem.click()
  const home = win.locator('[data-home]')
  const rows = home.locator('[data-home-item]')
  await expect(home).toHaveAttribute('data-home-loading', '')
  await expect(rows).toHaveCount(0)
  // SPEC 12: "rows show in rank order as the conversations they come from land, and no space is kept for rows that may come."
  // Adding rows may recenter the column; the composer and the spacing within the painted column stay fixed.
  await expectHomeSyncFrames(win, async () => {
    fake.release({ method: subscriptions })
    // Let pages land one at a time until Home paints a row while the sync still runs.
    await expect
      .poll(
        async () => {
          if ((await rows.count()) > 0) return true
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
    await expect(home).toHaveAttribute('data-home-loading', '')
    fake.release({ method })
    await expect.poll(() => fake.heldCount({ method: 'conversations.replies' }), { timeout: 30_000 }).toBeGreaterThan(0)
    await expect(juno.sidebar.syncStatus).toBeVisible()
    fake.release({ method: 'conversations.replies' })
    await expect(home).not.toHaveAttribute('data-home-loading', { timeout: 30_000 })
    await juno.expectEngineLive()
    await juno.sidebar.expectNoSyncStatus()
    await expect(rows.first()).toBeVisible()
  })
})
