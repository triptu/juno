// Bottom following (SPEC 7, "Stable geometry"): arrivals and growing rows stay above the composer from their
// first frame, including while the scrollbar thumb is held at the end. A full message window drops its first
// row without moving the viewport; an upward gesture lets go, and arrivals leave that scrolled position alone.
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'
import { TOPIC300_MAIN_CHANNEL, TOPIC300_THREAD_CHANNEL } from '@juno/fake-slack'
import type { Page } from '@playwright/test'
import { expect, test, type Fixtures } from './fixtures'
import type { Juno } from './driver/juno'
import { answer, JunoChatPane, test as chatTest } from './juno-agent/chat'
import { expectStableAnchor } from './shiftProbe'
import { expectRestSurvivesGrowth, expectScrollEscapesGrowth } from './scrollGrowthProbe'
import { distance, expectLastWhole, frames, holdThumbAtEnd, longerThanView, longTest, openLongMain, wheelDownAtEnd, wheelToEnd } from './stickBottomLists'
import { watchArrival, watchEditVisibility, watchResize, type Frame } from './stickBottomProbe'

test.describe.configure({ timeout: 90_000, mode: 'parallel' })

/** Every frame from the first that draws the row shows it whole, with the list at its end. */
function expectHeldAtEnd(frames: Frame[]): void {
  expect(frames.length, 'the row is drawn').toBeGreaterThan(1)
  expect(frames.filter((frame) => !frame.inView || frame.distance > 1)).toEqual([])
}

const TOPIC_SCROLLER = '[data-topic-view] [data-scroll]'
const PANEL_SCROLLER = 'aside[data-juno-panel] [data-scroll]'

test('keeps Main and a thread at the bottom through arrivals and composer growth, and holds its position when scrolled up', async ({ juno, win, slack, fake }) => {
  const root = fake.workspace.post({ channel: slack.channel('eng'), user: slack.as('Leo').id, text: 'Stick to the bottom thread check', silent: true })
  for (let i = 0; i < 30; i++) fake.workspace.post({ channel: slack.channel('eng'), user: slack.as(i % 2 === 0 ? 'Leo' : 'Maya').id, threadTs: root.ts, text: `Reply ${i}`, silent: true })
  await openLongMain(juno, fake, slack)
  const context = { juno, win, slack, fake }
  await test.step('Main at the bottom keeps a new message fully in view after a click on a message', () => mainArrival(context))
  await test.step('Main at the bottom keeps its last message in view while the composer grows', () => composerGrowth(context))
  await test.step('scrolled up in Main, a new message moves nothing and shows the pill', () => scrolledUpArrival(context))
  await test.step('a thread at the bottom keeps a new reply fully in view', () => threadArrival(context, root.ts))
})

/** Every frame from the first that draws the element shows it whole, at the list's end or anywhere in view. */
function expectWhole(frames: Frame[], { atEnd }: { readonly atEnd: boolean }): void {
  expect(frames.length, 'the element is drawn').toBeGreaterThan(1)
  expect(frames.filter((frame) => !frame.inView || (atEnd && frame.distance > 1))).toEqual([])
}

const EDITING = '[data-message-row][data-editing]'

/**
 * Editing the newest message of `place` keeps the edit box above the composer in every frame: one line or several,
 * with its own name line or grouped under the message before, opened from the menu or with ↑ then E. `other` posts
 * the message before when it is not the user's.
 */
async function editLastStaysAbove({ juno, win, fake }: Pick<Fixtures, 'juno' | 'win' | 'fake'>, place: string, channel: string, other: string, threadTs?: string): Promise<void> {
  const { topic } = juno
  const thread = threadTs === undefined ? {} : { threadTs }
  for (const multiline of [false, true]) {
    for (const grouped of [false, true]) {
      const name = `${multiline ? 'multiline' : 'one line'}, ${grouped ? 'grouped' : 'name line'}`
      fake.injectMessage({ channel, ...thread, user: grouped ? fake.workspace.selfId : other, text: `Previous message for ${name}` })
      await topic.expectMessage(`Previous message for ${name}`)
      const firstLine = `My last message: ${name}`
      await topic.send(multiline ? `${firstLine}\nA second line\nA third line\nA fourth line` : firstLine)
      await topic.expectSent(firstLine)
      const row = topic.message(firstLine)
      await expect(row.locator('[data-message-header]')).toHaveCount(grouped ? 0 : 1)
      await expect(row.locator('[data-reaction]')).toHaveCount(0)
      await expect(topic.list.locator('[data-message-row]').last()).toContainText(firstLine)

      for (const method of ['right click', 'Up then E'] as const) {
        await test.step(`${name}: ${method}`, async () => {
          await topic.expectAtBottom()
          await expect(topic.composer).toHaveValue('')
          const watched = await watchEditVisibility(win)
          if (method === 'Up then E') {
            await topic.composer.press('ArrowUp')
            await expect(row).toBeFocused()
            await row.press('e')
          } else {
            await (await juno.messageMenu.openOnRow(row, { scroll: false })).choose('edit')
          }
          await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
          await expect(topic.list.locator(EDITING).getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
          await expect(topic.list.locator(EDITING).getByRole('button', { name: /^Save/ })).toBeVisible()
          await frames(win, 12)
          const samples = await watched()
          await test.info().attach(`${name}-${method}`, { body: JSON.stringify(samples), contentType: 'application/json' })
          console.log(`${place}, ${name}, ${method}: ${samples.length} frames, hidden below ${Math.max(...samples.map((sample) => sample.hiddenBelow))}px, above ${Math.max(...samples.map((sample) => sample.hiddenAbove))}px`)
          expect(samples.length).toBeGreaterThanOrEqual(10)
          expect(samples.filter((sample) => sample.hiddenAbove > 0 || sample.hiddenBelow > 0 || sample.buttons !== 2)).toEqual([])
          await win.keyboard.press('Escape')
          await expect(topic.list.locator(EDITING)).toHaveCount(0)
        })
      }
    }
  }
}

// A DM is the same TopicView as Main; the thread view is checked on its own (below), since a thread window once broke it alone.
test('Main: editing the last message without reactions stays above the composer', async ({ juno, win, slack, fake }) => {
  const channel = slack.channel('eng')
  for (let i = 0; i < 30; i++) fake.workspace.post({ channel, user: slack.as(i % 2 === 0 ? 'Maya' : 'Leo').id, text: `Edit history ${i}`, silent: true })
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng', { exact: true }).open()
  await juno.topic.expectMessage('Edit history 29')
  await juno.topic.toLatest()
  expect(await longerThanView(juno.topic.scroller)).toBe(true)
  await editLastStaysAbove({ juno, win, fake }, 'Main', channel, slack.as('Maya').id)
})

test('keeps the last message of Main whole as it grows at the bottom, and still when scrolled up', async ({ juno, win, slack, fake }) => {
  const channel = await openLongMain(juno, fake, slack)
  const { topic } = juno

  await test.step('at the bottom, a reaction from someone else on the last message shows whole', async () => {
    const text = 'A message Leo reacts to'
    const message = fake.injectMessage({ channel, user: slack.as('Maya').id, text })
    await topic.expectMessage(text)
    await topic.expectAtBottom()
    const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', text)
    fake.addReaction({ channel, ts: message.ts, name: 'eyes', user: slack.as('Leo').id })
    // The reaction chip itself.
    await expect(topic.message(text).getByRole('button', { name: '1 👀' })).toBeVisible()
    await frames(win, 5)
    expectWhole(await watched(), { atEnd: true })
  })

  const own = 'My message to react to and edit'
  await test.step('at the bottom, the user’s own reaction on the last message shows whole', async () => {
    await topic.send(own)
    await topic.expectSent(own)
    await topic.expectAtBottom()
    const row = topic.message(own)
    const menu = await juno.messageMenu.openOnRow(row, { scroll: false })
    const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', own)
    await menu.react('+1')
    await expect(row.getByRole('button', { name: '1 👍, including you' })).toBeVisible()
    await frames(win, 5)
    expectWhole(await watched(), { atEnd: true })
  })

  await test.step('at the bottom, editing the last message shows the whole edit box', async () => {
    await win.mouse.move(0, 0)
    await topic.composer.focus()
    await topic.composer.press('ArrowUp')
    await expect(topic.message(own)).toBeFocused()
    const watched = await watchArrival(win, TOPIC_SCROLLER, EDITING, '')
    await topic.message(own).press('e')
    await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
    await frames(win, 5)
    expectWhole(await watched(), { atEnd: true })
    await win.keyboard.press('Escape')
    await expect(topic.list.locator(EDITING)).toHaveCount(0)
  })

  await test.step('just above the bottom, editing the last message from its menu shows the whole edit box', async () => {
    await topic.expectAtBottom()
    await topic.scrollUp(40)
    expect(await distance(topic.scroller)).toBeGreaterThan(32)
    const row = topic.message(own)
    const menu = await juno.messageMenu.openOnRow(row, { scroll: false })
    const watched = await watchArrival(win, TOPIC_SCROLLER, EDITING, '')
    await menu.choose('edit')
    await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
    await frames(win, 5)
    expectWhole(await watched(), { atEnd: false })
    await win.keyboard.press('Escape')
    await expect(topic.list.locator(EDITING)).toHaveCount(0)
  })

  await test.step('scrolled up, a reaction on the last message moves nothing', async () => {
    const text = 'The last message, reacted to while scrolled up'
    await topic.send(text)
    await topic.expectSent(text)
    await topic.expectAtBottom()
    await topic.scrollUp(600)
    const top = await topic.scroller.evaluate((node) => node.scrollTop)
    const ts = fake.messages(channel).find((m) => m.text === text)!.ts
    await expectStableAnchor(win, '[data-topic-view] [data-message-row]', async () => {
      fake.addReaction({ channel, ts, name: 'tada', user: slack.as('Maya').id })
      await expect(topic.message(text).getByRole('button', { name: /🎉/ })).toHaveCount(1)
    })
    expect(await topic.scroller.evaluate((node) => node.scrollTop)).toBe(top)
  })
})

test('releases the bottom during an upward gesture and uses the resting threshold for later growth', async ({ juno, win, slack, fake }) => {
  const channel = await openLongMain(juno, fake, slack)
  const { topic } = juno
  const last = fake.messages(channel).find((message) => message.text === 'Earlier message 29')!
  const grown = 'The last message grows\nAnother line\nAnd another line'

  await test.step('growth during a continuous upward gesture does not pull the list back down', async () => {
    const box = (await topic.scroller.boundingBox())!
    const start = await topic.scroller.evaluate((node) => node.scrollTop)
    const cdp = await win.context().newCDPSession(win)
    try {
      const gesture = cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, yDistance: 900, speed: 600, gestureSourceType: 'mouse', preventFling: false })
      try {
        await expect.poll(() => topic.scroller.evaluate((node) => node.scrollTop)).toBeLessThan(start - 64)
        fake.editMessage({ channel, ts: last.ts, text: grown })
        await topic.expectMessage('The last message grows')
        expect(await topic.scroller.evaluate((node) => node.scrollTop)).toBeLessThan(start - 64)
      } finally {
        await gesture
      }
    } finally {
      await cdp.detach()
    }
    expect(await distance(topic.scroller)).toBeGreaterThan(600)
  })

  await test.step('resting within 32px holds the bottom on growth', async () => {
    await topic.toLatest()
    await topic.scrollUp(16)
    expect(await distance(topic.scroller)).toBeLessThanOrEqual(32)
    fake.editMessage({ channel, ts: last.ts, text: `${grown}\nOne more line` })
    await topic.expectMessage('One more line')
    await frames(win, 5)
    expect(await distance(topic.scroller)).toBeLessThanOrEqual(1)
  })

  await test.step('resting outside 32px leaves the viewport alone on growth', async () => {
    await topic.scrollUp(40)
    expect(await distance(topic.scroller)).toBeGreaterThan(32)
    const top = await topic.scroller.evaluate((node) => node.scrollTop)
    await expectStableAnchor(win, '[data-topic-view] [data-message-row]', async () => {
      fake.editMessage({ channel, ts: last.ts, text: `${grown}\nOne more line\nThe final line` })
      await topic.expectMessage('The final line')
    })
    expect(await topic.scroller.evaluate((node) => node.scrollTop)).toBe(top)
  })

  await test.step('an upward gesture escapes concurrent column growth from the first scroll frame', async () => {
    await topic.toLatest()
    await expectScrollEscapesGrowth(win, topic.scroller, topic.list.locator('[data-message-row]').last())
  })
})

/**
 * After a scroll up by hand back to the end, a full window follows new messages: after the wheel, with the scrollbar
 * thumb held at the end, and not while the thumb is dragged above it. `post` sends a message to the open topic.
 */
async function backAtEnd(juno: Juno, win: Page, post: (text: string) => void): Promise<void> {
  const { topic } = juno
  await test.step('the wheel up a few screens and back down to the end', async () => {
    await topic.scrollUp(1_500)
    expect(await distance(topic.scroller)).toBeGreaterThan(1_000)
    await wheelToEnd(win, topic.scroller)
    for (let i = 1; i <= 3; i++) {
      post(`After the wheel ${i}`)
      await topic.expectMessage(`After the wheel ${i}`)
    }
    await frames(win, 5)
    await expectLastWhole(juno, 'After the wheel 3')
  })

  // The scroll has reached the end but has not ended: the thumb is still held, as fingers resting on the trackpad
  // keep a gesture going. A message that arrives then is followed, and so is every one after the scroll ends.
  await test.step('the scrollbar thumb held at the end while a message arrives', async () => {
    await topic.scrollUp(1_500)
    expect(await distance(topic.scroller)).toBeGreaterThan(1_000)
    await holdThumbAtEnd(win, topic.scroller)
    post('While the thumb is held')
    await topic.expectMessage('While the thumb is held')
    await frames(win, 5)
    await expectLastWhole(juno, 'While the thumb is held')
    await win.mouse.up()
    await frames(win, 10)
    for (let i = 1; i <= 3; i++) {
      post(`After the thumb ${i}`)
      await topic.expectMessage(`After the thumb ${i}`)
    }
    await frames(win, 5)
    await expectLastWhole(juno, 'After the thumb 3')
  })

  await test.step('dragging the thumb upward leaves the bottom while messages arrive', async () => {
    await holdThumbAtEnd(win, topic.scroller)
    const box = (await topic.scroller.boundingBox())!
    await win.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 8 })
    await expect.poll(() => distance(topic.scroller)).toBeGreaterThan(1_000)
    post('While the thumb is above the bottom')
    await expect.poll(() => topic.message('While the thumb is above the bottom').count()).toBe(1)
    expect(await distance(topic.scroller)).toBeGreaterThan(1_000)
    await expect(topic.message('While the thumb is above the bottom')).not.toBeInViewport()
    await win.mouse.up()
  })
}

/** Opens `title` read to its end and then again, so it shows its newest 150 rows and each arrival drops the first. */
async function openFullWindow(juno: Juno, title: string): Promise<void> {
  await juno.signIn()
  await juno.waitForSync()
  // The first open reads the topic. Opened again, it shows its newest 150 rows, so each message that arrives drops
  // the first row, and scroll anchoring lowers scrollTop by that row's height.
  const row = juno.sidebar.row(title)
  await row.open()
  await row.expectRead()
  await juno.tabs.menu('close-tab')
  await row.open()
  await juno.topic.expectAtBottom()
}

longTest('Main: back at the end after scrolling up by hand, a full window follows new messages', async ({ juno, win, fake }) => {
  await openFullWindow(juno, '#perf-main')
  await backAtEnd(juno, win, (text) => void fake.injectMessage({ channel: TOPIC300_MAIN_CHANNEL, user: 'U0PERFLEO', text }))
})

longTest('thread: editing the last message stays above the composer, and back at the end after scrolling up by hand a full window follows new messages', async ({ juno, win, fake }) => {
  const title = 'Review the rollout checklist 1'
  await openFullWindow(juno, title)
  const threadTs = fake.workspace.main(TOPIC300_THREAD_CHANNEL).find((message) => message.text?.startsWith(title))!.ts
  const post = (text: string) => void fake.injectMessage({ channel: TOPIC300_THREAD_CHANNEL, user: 'U0PERFLEO', threadTs, text })
  await editLastStaysAbove({ juno, win, fake }, 'thread', TOPIC300_THREAD_CHANNEL, 'U0PERFMAYA', threadTs)
  await juno.topic.toLatest()
  await backAtEnd(juno, win, post)
})

async function mainArrival({ juno, win, slack, fake }: Pick<Fixtures, 'juno' | 'win' | 'slack' | 'fake'>): Promise<void> {
  const channel = slack.channel('eng')
  await juno.topic.message('Earlier message 29').click()
  await frames(win, 10)
  expect(await distance(juno.topic.scroller)).toBeLessThanOrEqual(1)

  const text = 'A new message at the bottom of Main'
  const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', text)
  fake.injectMessage({ channel, user: slack.as('Maya').id, text })
  await juno.topic.expectMessage(text)
  await frames(win, 5)
  expectHeldAtEnd(await watched())
  await juno.topic.expectNoPill()
}

async function threadArrival({ juno, win, slack, fake }: Pick<Fixtures, 'juno' | 'win' | 'slack' | 'fake'>, rootTs: string): Promise<void> {
  const channel = slack.channel('eng')
  await juno.topic.list.locator(`[data-thread-link="t:${channel}:${rootTs}"]`).click()
  await juno.topic.expectMessage('Reply 29')
  await juno.topic.toLatest()
  expect(await longerThanView(juno.topic.scroller)).toBe(true)
  await wheelDownAtEnd(win, juno.topic.scroller)

  const text = 'A new reply at the bottom of the thread'
  const watched = await watchArrival(win, TOPIC_SCROLLER, '[data-message-row]', text)
  fake.injectMessage({ channel, user: slack.as('Leo').id, threadTs: rootTs, text })
  await juno.topic.expectMessage(text)
  await frames(win, 5)
  expectHeldAtEnd(await watched())
  await juno.topic.expectNoPill()
}

async function composerGrowth({ juno, win }: Pick<Fixtures, 'juno' | 'win'>): Promise<void> {
  const height = await juno.topic.scroller.evaluate((node) => node.clientHeight)
  const watched = await watchResize(win, TOPIC_SCROLLER)
  await juno.topic.composer.fill('one\ntwo\nthree\nfour\nfive')
  // The first entry is the observer's own first look, before the composer grew; a later one is the list shrunk.
  expectHeldAtEnd(await watched(height))
  expect(await distance(juno.topic.scroller)).toBeLessThanOrEqual(1)
}

async function scrolledUpArrival({ juno, win, slack, fake }: Pick<Fixtures, 'juno' | 'win' | 'slack' | 'fake'>): Promise<void> {
  await juno.topic.composer.fill('')
  await juno.topic.expectAtBottom()
  const channel = slack.channel('eng')
  await juno.topic.scrollUp(600)
  await expectStableAnchor(win, '[data-topic-view] [data-message-row]', async () => {
    fake.injectMessage({ channel, user: slack.as('Maya').id, text: 'A new message while scrolled up' })
    await juno.topic.expectPill('1 new message')
  })
}

/** The chat test with a model that holds its answer to a message with "held" in it until the gate opens. */
const heldTest = chatTest.extend<{ readonly gate: { readonly wait: Promise<void>; readonly open: () => void } }>({
  // oxlint-disable-next-line no-empty-pattern
  gate: async ({}, use) => {
    let open = () => {}
    const wait = new Promise<void>((resolve) => (open = resolve))
    await use({ wait, open })
    open()
  },
  model: async ({ gate }, use) => {
    const model = await startFakeOpenRouter({
      answer: async (request) => {
        if (request.input.includes('held')) await gate.wait
        return answer(request)
      },
    })
    await use(model)
    await model.close()
  },
})

heldTest('the Juno panel at the bottom keeps a new answer fully in view', async ({ juno, win, gate }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.setWindowSize(1400)
  await juno.sidebar.row('Draft plan is in the doc').open()
  await juno.tabs.menu('juno')
  const panel = JunoChatPane.panel(win)
  for (let i = 1; i <= 8; i++) {
    const ask = `question ${i}: what did Leo and Maya decide about the cutover window, the fallback primary and who reviews the plan`
    await panel.send(ask)
    await panel.expectJuno(`You said: ${ask}`)
  }
  const scroller = win.locator(PANEL_SCROLLER)
  await frames(win, 5)
  expect(await longerThanView(scroller)).toBe(true)

  // Juno is still answering while the owner, at the end, turns the wheel down.
  const ask = 'a held question at the bottom of the panel'
  await panel.send(ask)
  await panel.expectOwner(ask)
  await frames(win, 5)
  await wheelDownAtEnd(win, scroller)
  const watched = await watchArrival(win, PANEL_SCROLLER, '[data-chat-juno]', `You said: ${ask}`)
  gate.open()
  await panel.expectJuno(`You said: ${ask}`)
  await frames(win, 5)
  expectHeldAtEnd(await watched())
  await expectRestSurvivesGrowth(scroller, '[data-chat-juno]')
  await expectScrollEscapesGrowth(win, scroller, scroller.locator('[data-chat-juno]').last())
})
