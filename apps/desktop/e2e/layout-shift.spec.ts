import { expect, hooks, test } from './fixtures'
import { JunoChatPane, test as chatTest } from './juno-agent/chat'
import { expectStableAnchor } from './shiftProbe'

test.describe.configure({ timeout: 60_000, mode: 'parallel' })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'

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

test('a late reaction keeps the last message fixed', async ({ juno, win, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  const row = juno.topic.list.locator('[data-message-row]').last()
  const ts = await row.getAttribute('data-message-row')
  expect(ts).not.toBeNull()
  const selector = `[data-message-row="${ts}"]`
  await expectStableAnchor(win, selector, async () => {
    fake.addReaction({ channel: slack.root(POSTGRES).channel, ts: ts!, name: 'eyes', user: slack.as('Leo').id })
    await expect(row.getByRole('list', { name: 'Reactions' })).toBeVisible()
  })
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

test('a sender name resolves without moving the timestamp or message', async ({ juno, win, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const person = { ...fake.workspace.users.get(slack.as('Leo').id)!, id: 'U0LATE', name: 'late', profile: { display_name: 'Leonard Alexander Park', real_name: 'Leonard Alexander Park' } }
  fake.workspace.users.set(person.id, person)
  fake.holdNext({ method: 'edge:users/info' })
  const message = fake.injectMessage({ channel: slack.channel('eng'), user: person.id, text: 'A message before its sender resolves' })
  await juno.sidebar.row('#eng').open()
  await juno.topic.expectMessage('A message before its sender resolves')
  await expect.poll(() => fake.heldCount({ method: 'edge:users/info' })).toBe(1)
  await expectStableAnchor(win, `[data-message-row="${message.ts}"] time`, async () => {
    fake.release({ method: 'edge:users/info' })
    await expect(juno.topic.list.getByText('Leonard Alexander Park', { exact: true }).first()).toBeVisible()
  })
})

test('a Main message gains a thread link without moving', async ({ juno, win, slack, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const channel = slack.channel('deploys')
  const user = slack.as('Leo').id
  const root = fake.injectMessage({ channel, user, text: 'A new Main message for the thread slot' })
  await win.getByRole('button', { name: 'Automated', exact: true }).click()
  await juno.sidebar.row('#deploys').open()
  await juno.topic.expectMessage('A new Main message for the thread slot')
  const threads = juno.topic.header.getByRole('button', { name: /^Threads/ })
  await expect(threads).toHaveAttribute('aria-label', 'Threads')
  const counter = threads.locator('svg')
  const counterBefore = await counter.boundingBox()
  await expectStableAnchor(win, `[data-message-row="${root.ts}"]`, async () => {
    fake.injectMessage({ channel, user, threadTs: root.ts, text: 'A reply arriving after Main paints' })
    await expect(juno.topic.list.locator(`[data-thread-link="t:${channel}:${root.ts}"]`)).toBeVisible()
    await expect(threads).toHaveAttribute('aria-label', 'Threads, 1')
    expect(await counter.boundingBox()).toEqual(counterBefore)
  })
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
    if (destination === 'All topics') await juno.allTopics.open()
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
