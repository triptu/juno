// Sending from a topic (spec section 8; architecture 5.7): the message shows
// at once and settles in place in a thread, and the composer grows to about
// eight lines. Main's echo before the answer, a refused send with Retry and
// Delete draft, and drafts kept across tabs and a restart are in the DOM lane
// (`dom/send.test.ts`).
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { expect, test, type Fixtures } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'

test('a reply in a thread shows at once and settles in place, posted once; the composer grows to about eight lines, then scrolls inside, and Shift Enter adds a line', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.expectAtBottom()
  await test.step('a reply in a thread shows at once and settles in place, posted once', () => sendReply(juno, fake))
  await test.step('the composer grows to about eight lines, then scrolls inside, and Shift Enter adds a line', () => composerGrowth(juno, fake))
})

async function sendReply(juno: Fixtures['juno'], fake: Fixtures['fake']): Promise<void> {
  const { topic } = juno

  // The answer waits, so the pending row is on screen until it is released.
  fake.holdNext({ method: 'chat.postMessage', before: true })
  await expect(topic.composerField).toBeVisible()
  const field = await topic.composerField.boundingBox()
  await topic.send('Thursday works for the freeze')
  await expect(topic.message('Thursday works for the freeze')).toHaveAttribute('data-pending', 'sending')
  await expect(topic.composer).toHaveValue('')
  expect(await topic.composerField.boundingBox()).toEqual(field)
  await topic.expectAtBottom()

  const row = topic.message('Thursday works for the freeze')
  const before = await row.boundingBox()
  // The sidebar moves the thread to the top for its new activity, as it should; the topic moves nothing.
  const report = await measureLayoutShift(
    juno.win,
    async () => {
      fake.release()
      await topic.expectSent('Thursday works for the freeze')
    },
    { root: '[data-topic-view]', settleMs: 200 },
  )
  // No message row moved. The list's own height may change as rows far above the view reach their real
  // size (they are laid out at an estimate until then), and the browser's shift entries cover the whole window.
  expect(report.moved.filter((moved) => moved.element.includes('listitem'))).toEqual([])
  expect(await topic.message('Thursday works for the freeze').boundingBox()).toEqual(before)

  const posted = fake.calls.filter((call) => call.method === 'chat.postMessage')
  expect(posted).toHaveLength(1)
  expect(posted[0]!.args['thread_ts']).toBeDefined()
  const copies = fake.messages(String(posted[0]!.args['channel'])).filter((m) => m.client_msg_id === posted[0]!.args['client_msg_id'])
  expect(copies).toHaveLength(1)
}

async function composerGrowth(juno: Fixtures['juno'], fake: Fixtures['fake']): Promise<void> {
  const { topic } = juno
  const posts = () => fake.calls.filter((call) => call.method === 'chat.postMessage').length
  const postedBefore = posts()
  const one = (await topic.composer.boundingBox())!.height
  await topic.composer.fill('one\ntwo\nthree')
  const three = (await topic.composer.boundingBox())!.height
  expect(three).toBeGreaterThan(one)
  await topic.composer.fill(Array.from({ length: 14 }, (_, i) => `Line ${i + 1}`).join('\n'))
  const capped = (await topic.composer.boundingBox())!.height
  expect(capped).toBeGreaterThan(150)
  expect(capped).toBeLessThanOrEqual(194)
  expect(await topic.composer.evaluate((field) => field.scrollHeight > field.clientHeight)).toBe(true)
  // Shift Enter adds a line, it does not send.
  await topic.composer.fill('first line')
  await topic.composer.press('Shift+Enter')
  await topic.composer.pressSequentially('second line')
  await expect(topic.composer).toHaveValue('first line\nsecond line')
  expect(posts()).toBe(postedBefore)
}
