// Bottom following (SPEC 7, "Stable geometry"): arrivals and growing rows stay above the composer from their
// first frame, including while the scrollbar thumb is held at the end. A full message window drops its first
// row without moving the viewport; an upward gesture lets go, and arrivals leave that scrolled position alone.
import { TOPIC300_THREAD_CHANNEL } from '@juno/fake-slack'
import { expect, syncedTest, test, type Fixtures } from './fixtures'
import { expectStableAnchor } from './shiftProbe'
import { expectRestSurvivesGrowth, expectScrollEscapesGrowth } from './scrollGrowthProbe'
import { backAtEnd, distance, frames, longTest, openFullWindow, openLongMain, wheelToEnd } from './stickBottomLists'
import { watchArrival, watchEditVisibility, watchResize, type Frame } from './stickBottomProbe'

test.describe.configure({ timeout: 90_000, mode: 'parallel' })

/** Every frame from the first that draws the row shows it whole, with the list at its end. */
function expectHeldAtEnd(frames: Frame[]): void {
  expect(frames.length, 'the row is drawn').toBeGreaterThan(1)
  expect(frames.filter((frame) => !frame.inView || frame.distance > 1)).toEqual([])
}

const TOPIC_SCROLLER = '[data-topic-view] [data-scroll]'


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
          await expect(topic.list.locator('textarea[aria-label="Edit message"]')).toBeFocused()
          await expect(topic.list.locator(EDITING).locator('button', { hasText: /^Cancel$/ })).toBeVisible()
          await expect(topic.list.locator(EDITING).locator('button', { hasText: /^Save/ })).toBeVisible()
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

syncedTest('keeps Main at the bottom through arrivals, composer growth and a growing last message, and holds its position when scrolled up', async ({ juno, win, slack, fake }) => {
  const channel = await openLongMain(juno, fake, slack)
  const context = { juno, win, slack, fake }
  const { topic } = juno
  await test.step('Main at the bottom keeps a new message fully in view after a click on a message', () => mainArrival(context))
  await test.step('Main at the bottom keeps its last message in view while the composer grows', () => composerGrowth(context))
  await test.step('scrolled up in Main, a new message moves nothing and shows the pill', () => scrolledUpArrival(context))
  await topic.toLatest()

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

syncedTest('releases the bottom during an upward gesture, uses the resting threshold for later growth, and a scroll that stops short of the end stays put', async ({ juno, win, slack, fake }) => {
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
    await wheelToEnd(win, topic.scroller)
    await expectScrollEscapesGrowth(win, topic.scroller, topic.list.locator('[data-message-row]').last())
  })

  await test.step('a scroll down that stops just short of the end stays where it stopped', async () => {
    await topic.toLatest()
    const away = () => distance(topic.scroller)
    await topic.scrollUp(24)
    const before = await away()
    expect(before).toBeGreaterThan(9)
    expect(before).toBeLessThanOrEqual(32)
    // Part of the way back down from a script, as scrolling a row into view does. Resting within 32px held the bottom,
    // but no row grew, so the list stays where the scroll put it and the row under a still pointer stays there.
    await topic.scroller.evaluate(async (node) => {
      const ended = new Promise<void>((resolve) => node.addEventListener('scrollend', () => resolve(), { once: true }))
      node.scrollTop += 8
      await ended
      for (let i = 0; i < 5; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(await away()).toBe(before - 8)
  })
  // The probe scrolls to the end itself, so the step above does not change what it checks.
  await test.step('a resting bottom survives growth during a coalesced scrollend', () => expectRestSurvivesGrowth(topic.scroller, '[data-message-row]'))
})

// The thread window is checked on its own, since a thread window once broke it alone (e37e5df81); a DM and Main are
// the same TopicView.
longTest('thread: editing the last message stays above the composer, and back at the end after scrolling up by hand a full window follows new messages', async ({ juno, win, fake }) => {
  const title = 'Review the rollout checklist 1'
  await openFullWindow(juno, title)
  const threadTs = fake.workspace.main(TOPIC300_THREAD_CHANNEL).find((message) => message.text?.startsWith(title))!.ts
  const post = (text: string) => void fake.injectMessage({ channel: TOPIC300_THREAD_CHANNEL, user: 'U0PERFLEO', threadTs, text })
  await editLastStaysAbove({ juno, win, fake }, 'thread', TOPIC300_THREAD_CHANNEL, 'U0PERFMAYA', threadTs)
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
