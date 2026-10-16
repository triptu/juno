// Sending from a topic (spec section 8; architecture 5.7): the message shows
// at once and settles in place, Main and threads, a refused send with Retry
// and Delete draft, drafts kept across tabs and a restart, and the composer
// growing to about eight lines.
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
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

// `loseResponse` runs the call, then closes the connection with no answer. Chromium's network
// stack then sends the request again by itself, so Slack runs it twice (ADR 0014). Juno keeps the
// first copy it stores and deletes the other, which has the same client_msg_id.
test('a post whose answer is lost is in Slack once', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  fake.loseResponse({ method: 'chat.postMessage', times: 1 })
  await topic.send('Sent once over a lost answer')
  await topic.expectSent('Sent once over a lost answer')
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Sent once over a lost answer').length).toBe(1)
  // Every post call ran, the lost one too: each copy after the first has been deleted, and nothing shows it again.
  const copies = fake.calls.filter((call) => call.method === 'chat.postMessage').length
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.delete' && call.ok).length).toBe(copies - 1)
  await expect(topic.message('Sent once over a lost answer')).toHaveCount(1)
})

test('an edit whose answer is lost leaves one message with the new text', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.send('Edit me over a lost answer')
  await topic.expectSent('Edit me over a lost answer')
  const before = fake.messages('C0ENG').length
  await juno.chooseNextMenuItem('edit')
  await topic.message('Edit me over a lost answer').click({ button: 'right' })
  const field = topic.list.getByRole('textbox', { name: 'Edit message' })
  await field.fill('Edited over a lost answer')
  fake.loseResponse({ method: 'chat.update', times: 1 })
  await field.press('Enter')
  await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Edited over a lost answer').length).toBe(1)
  await expect(field).toHaveCount(0)
  await topic.expectSent('Edited over a lost answer')
  await expect(topic.message('Edit me over a lost answer')).toHaveCount(0)
  expect(fake.messages('C0ENG')).toHaveLength(before)
})

test('a reaction whose answer is lost is added once and taken away once', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'React over a lost answer' })
  const row = topic.message('React over a lost answer')
  await expect(row).toBeVisible()
  const ts = fake.messages('C0ENG').find((m) => m.text === 'React over a lost answer')!.ts
  const reactionsOf = () => fake.messages('C0ENG').find((m) => m.ts === ts)?.reactions ?? []

  fake.loseResponse({ method: 'reactions.add', times: 1 })
  await row.hover()
  await row.getByRole('button', { name: 'React 👍' }).click()
  const chip = row.getByRole('button', { name: '1 👍, including you' })
  await expect(chip).toBeVisible()
  await expect.poll(reactionsOf).toEqual([expect.objectContaining({ name: '+1', count: 1 })])
  await expect.poll(() => fake.calls.some((call) => call.method === 'reactions.add' && (call.ok || call.error === 'already_reacted'))).toBe(true)
  await expect(chip).toBeVisible()

  fake.loseResponse({ method: 'reactions.remove', times: 1 })
  await chip.click()
  await expect(row.getByRole('button', { name: /^\d+ 👍/ })).toHaveCount(0)
  await expect.poll(() => reactionsOf().some((r) => r.name === '+1')).toBe(false)
  await expect.poll(() => fake.calls.some((call) => call.method === 'reactions.remove' && (call.ok || call.error === 'no_reaction'))).toBe(true)
  await expect(row.getByRole('button', { name: /^\d+ 👍/ })).toHaveCount(0)
})
