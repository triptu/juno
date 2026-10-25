// Sending from a topic (spec section 8; architecture 5.7): the message shows
// at once and settles in place, Main and threads, a refused send with Retry
// and Delete draft, drafts kept across tabs and a restart, and the composer
// growing to about eight lines.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ENG_MAIN = '#eng'

interface SavedTab {
  readonly id: string
  readonly place?: { readonly kind: string; readonly topicId?: string }
  readonly homeDraft?: { readonly draft?: string; readonly conversation?: unknown }
}

/** The tabs and topic drafts user.db holds (drafts by text), read while the app runs: what a relaunch reads back. */
function saved(userData: string, teamId: string): { readonly tabs: ReadonlyArray<SavedTab>; readonly active: SavedTab | undefined; readonly drafts: ReadonlyMap<string, string> } {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'user.db'), { readOnly: true })
  try {
    const row = db.prepare("SELECT value_json FROM prefs WHERE key = 'tabs'").get() as { value_json: string } | undefined
    const value = row === undefined ? undefined : (JSON.parse(row.value_json) as { readonly tabs: ReadonlyArray<SavedTab>; readonly active: string | null })
    const drafts = new Map(db.prepare('SELECT topic_id, text FROM drafts').all().map((draft) => [String(draft['text']), String(draft['topic_id'])]))
    const tabs = value?.tabs ?? []
    return { tabs, active: tabs.find((tab) => tab.id === value?.active), drafts }
  } finally {
    db.close()
  }
}

test('a reply in a thread shows at once and settles in place, posted once', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.expectAtBottom()

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
})

test('in Main, a message settles when the echo comes before the answer, and a refused send stays with Retry and Delete draft', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await test.step('a message settles when the echo comes before the answer', async () => {
    fake.holdNext({ method: 'chat.postMessage' })
    await topic.send('Lunch order goes in at noon')
    await topic.expectSent('Lunch order goes in at noon')
    fake.release()
    // The same channel's next send waits for the first HTTP answer to finish.
    await topic.send('Then book a table for six')
    await topic.expectSent('Then book a table for six')
    await topic.expectSent('Lunch order goes in at noon')
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.args['channel'])).toEqual(['C0ENG', 'C0ENG'])
  })

  await test.step('a refused send stays in the row with Retry and Delete draft', async () => {
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
})

test('the composer grows to about eight lines, and a draft is kept per topic across tab switches and a restart', async ({ juno, relaunch, userData, fake }) => {
  const { topic, sidebar } = juno
  await sidebar.row(POSTGRES).open()

  await test.step('the composer grows to about eight lines, then scrolls inside', async () => {
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
    expect(fake.calls.filter((call) => call.method === 'chat.postMessage')).toEqual([])
  })

  await test.step('a draft is kept per topic across tab switches and a restart', async () => {
    await topic.composer.fill('Half a thought about the freeze')
    await sidebar.row(RINA).openInNewTab()
    await topic.expectTitle(RINA)
    await expect(topic.composer).toHaveValue('')
    await juno.tabs.menu('previous-tab')
    await topic.expectTitle(POSTGRES)
    await expect(topic.composer).toHaveValue('Half a thought about the freeze')
    // The draft and the tabs, with the Postgres tab active, are in user.db before the quit.
    await expect
      .poll(() => {
        const state = saved(userData, fake.teamId)
        const topic = state.drafts.get('Half a thought about the freeze')
        return topic !== undefined && state.active?.place?.topicId === topic && state.tabs.length === 2
      })
      .toBe(true)
    const restarted = await relaunch()
    await restarted.tabs.menu('previous-tab')
    await restarted.topic.expectTitle(POSTGRES)
    await expect(restarted.topic.composer).toHaveValue('Half a thought about the freeze')
  })
})

// `loseResponse` runs the call, then closes the connection with no answer. Chromium's network
// stack then sends the request again by itself, so Slack runs it twice (ADR 0014). Juno keeps the
// first copy it stores and deletes the other, which has the same client_msg_id.
test('a post, an edit and a reaction whose answer is lost each reach Slack once', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  await test.step('a post whose answer is lost is in Slack once', async () => {
    fake.loseResponse({ method: 'chat.postMessage', times: 1 })
    await topic.send('Sent once over a lost answer')
    await topic.expectSent('Sent once over a lost answer')
    await expect.poll(() => fake.messages('C0ENG').filter((m) => m.text === 'Sent once over a lost answer').length).toBe(1)
    // Every post call ran, the lost one too: each copy after the first has been deleted, and nothing shows it again.
    const copies = fake.calls.filter((call) => call.method === 'chat.postMessage').length
    await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.delete' && call.ok).length).toBe(copies - 1)
    await expect(topic.message('Sent once over a lost answer')).toHaveCount(1)
  })

  await test.step('an edit whose answer is lost leaves one message with the new text', async () => {
    await topic.send('Edit me over a lost answer')
    await topic.expectSent('Edit me over a lost answer')
    const before = fake.messages('C0ENG').length
    await topic.chooseInMessageMenu('Edit me over a lost answer', 'edit')
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

  await test.step('a reaction whose answer is lost is added once and taken away once', async () => {
    fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: 'React over a lost answer' })
    const row = topic.message('React over a lost answer')
    await expect(row).toBeVisible()
    const ts = fake.messages('C0ENG').find((m) => m.text === 'React over a lost answer')!.ts
    const reactionsOf = () => fake.messages('C0ENG').find((m) => m.ts === ts)?.reactions ?? []

    fake.loseResponse({ method: 'reactions.add', times: 1 })
    await (await topic.messageMenu('React over a lost answer')).react('+1')
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
})
