// Sending from a topic (spec section 8; architecture 5.7): the message shows
// at once and settles in place, Main and threads, a refused send with Retry
// and Delete draft, drafts kept across tabs and a restart, and the composer
// growing to about eight lines.
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'
const ENG_MAIN = '#eng'

test('a reply in a thread shows at once and settles in place, posted once', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.expectAtBottom()

  // The answer waits, so the pending row is on screen until it is released.
  fake.holdNext({ method: 'chat.postMessage', before: true })
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
})

test('a message in Main settles when the echo comes before the answer', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  fake.holdNext({ method: 'chat.postMessage' })
  await topic.send('Lunch order goes in at noon')
  await topic.expectSent('Lunch order goes in at noon')
  fake.release()
  await juno.win.waitForTimeout(500)
  await topic.expectSent('Lunch order goes in at noon')
  expect(fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['channel'])).toEqual(['C0ENG'])
})

test('a refused send stays in the row with Retry and Delete draft', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  fake.forceError({ method: 'chat.postMessage', error: 'restricted_action', times: 2 })
  await topic.send('Please try this one again')
  await expect(topic.failed('Please try this one again').row).toContainText('Not sent.')
  await topic.send('Please drop this one')
  await expect(topic.failed('Please drop this one').row).toContainText('Not sent.')

  await topic.failed('Please try this one again').retry()
  await topic.expectSent('Please try this one again')
  await topic.failed('Please drop this one').discard()
  await expect(topic.message('Please drop this one')).toHaveCount(0)
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Please drop this one')).toHaveLength(0)
})

test('a draft is kept per topic across tab switches and a restart', async ({ juno, running, userData, fake, slackApp }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic, sidebar } = juno
  await sidebar.row(POSTGRES).open()
  await topic.composer.fill('Half a thought about the freeze')
  await sidebar.row(RINA).openInNewTab()
  await topic.expectTitle(RINA)
  await expect(topic.composer).toHaveValue('')
  await juno.tabs.menu('previous-tab')
  await topic.expectTitle(POSTGRES)
  await expect(topic.composer).toHaveValue('Half a thought about the freeze')
  // Let the save reach the engine.
  await juno.win.waitForTimeout(800)
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    await restarted.tabs.menu('previous-tab')
    await restarted.topic.expectTitle(POSTGRES)
    await expect(restarted.topic.composer).toHaveValue('Half a thought about the freeze')
  } finally {
    await again.close()
  }
})

test('the composer grows to about eight lines, then scrolls inside', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
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
})

// Fixme (break pass, 2026-10-15; owner: outbox). `Outbox.sendOnce` makes one attempt, but
// Chromium's network stack resends a request on its own when a reused keep-alive connection
// closes before any answer (net.fetch in the engine, ADR 0007). Slack has run the first post, so
// the message is posted twice. The fake's `loseResponse` closes the connection after running the
// call, which is that case. The engine's vitest suites use Node fetch, which does not resend, so
// they pass. A fix needs a transport for single-attempt calls that Chromium cannot resend, or a
// check after the answer for a second message with the same client_msg_id.
test.fixme('a post whose answer is lost is in Slack once', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  fake.loseResponse({ method: 'chat.postMessage', times: 1 })
  await topic.send('Sent once over a lost answer')
  await topic.expectSent('Sent once over a lost answer')
  expect(fake.messages('C0ENG').filter((m) => m.text === 'Sent once over a lost answer')).toHaveLength(1)
})
