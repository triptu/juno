// The checks on send (spec section 8) with the fake AI: the wrong-place bar
// in a Main posts in the thread or sends to Main, the clarity bar fixes and
// sends or sends as is, Esc and editing return to the draft, the audience
// line in a public channel, Enter never waits for a slow model, and with AI
// assist off nothing is checked. The wrong-place question is asked while
// typing pauses; a test waits for its answer in `ai_cache` before Enter.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
/** Shares four words with the staging bill thread in #eng. */
const BILL_REPLY = 'the preview environments reaper should cut the staging bill'
const TYPOS = 'can you recieve the the report by friday'
const FIXED = 'can you receive the report by friday?'

/** Waits until the model's wrong-place answer for a draft typed after `since` is stored. */
async function routeAnswered(userData: string, teamId: string, since: number): Promise<void> {
  await expect
    .poll(
      () => {
        const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
        try {
          const row = db.prepare(`SELECT max(CAST(created_at AS INTEGER)) AS at FROM ai_cache WHERE task = 'routeCheck'`).get() as { at: number | null }
          return row.at ?? 0
        } finally {
          db.close()
        }
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(since)
}

/** Types a draft and waits for the typing pause's wrong-place answer. */
async function typeAndPause(topic: Juno['topic'], userData: string, teamId: string, text: string): Promise<void> {
  const since = Date.now()
  await topic.composer.fill(text)
  await routeAnswered(userData, teamId, since)
}

const posts = (fake: { calls: ReadonlyArray<{ method: string; args: Record<string, unknown> }> }) => fake.calls.filter((call) => call.method === 'chat.postMessage')

test('a reply typed into Main is offered to its thread, and Post in thread posts it there', async ({ juno, fake, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  const root = fake.messages('C0ENG').find((message) => (message.text ?? '').startsWith('Unrelated: has anyone looked at the staging bill'))!
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  const field = await topic.composer.boundingBox()
  await typeAndPause(topic, userData, fake.teamId, BILL_REPLY)
  await topic.composer.press('Enter')
  await expect(topic.checkBar.bar).toContainText('Looks like a reply to')
  await expect(topic.checkBar.bar).not.toContainText('%')
  // The bar grows the composer upwards; the text stays where it was.
  expect(await topic.composer.boundingBox()).toEqual(field)
  expect(posts(fake)).toHaveLength(0)

  // Enter takes the first choice.
  await topic.composer.press('Enter')
  await expect(topic.checkBar.bar).toHaveCount(0)
  await expect(topic.composer).toHaveValue('')
  await juno.expectToast('Posted in')
  await expect.poll(() => posts(fake).length).toBe(1)
  expect(posts(fake)[0]!.args['thread_ts']).toBe(root.ts)
  expect(posts(fake)[0]!.args['text']).toBe(BILL_REPLY)
})

test('Send to Main sends it where it was typed', async ({ juno, fake, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await typeAndPause(topic, userData, fake.teamId, BILL_REPLY)
  await topic.composer.press('Enter')
  await topic.checkBar.choose('Send to Main')
  await topic.expectSent(BILL_REPLY)
  expect(posts(fake)).toHaveLength(1)
  expect(posts(fake)[0]!.args['thread_ts']).toBeUndefined()
  await expect(topic.composer).toBeFocused()
})

test('the clarity bar lists minimal fixes; Fix and send sends the fixed text', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.send(TYPOS)
  await expect(topic.checkBar.bar).toContainText('3 fixes: recieve → receive, the the → the, add ?')
  await topic.composer.press('Enter')
  await topic.expectSent(FIXED)
  expect(posts(fake).map((call) => call.args['text'])).toEqual([FIXED])
})

test('Send as is sends the text as typed', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.send(TYPOS)
  await topic.checkBar.choose('Send as is')
  await topic.expectSent(TYPOS)
  expect(posts(fake).map((call) => call.args['text'])).toEqual([TYPOS])
})

test('Esc returns to editing with the draft as it was, and an edit closes the bar too', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
  await topic.send(TYPOS)
  await expect(topic.checkBar.bar).toBeVisible()
  await topic.composer.press('Escape')
  await expect(topic.checkBar.bar).toHaveCount(0)
  await expect(topic.composer).toHaveValue(TYPOS)
  await expect(topic.composer).toBeFocused()

  await topic.composer.press('Enter')
  await expect(topic.checkBar.bar).toBeVisible()
  await topic.composer.press('End')
  await topic.composer.pressSequentially('?')
  await expect(topic.checkBar.bar).toHaveCount(0)
  await expect(topic.composer).toHaveValue(`${TYPOS}?`)
  expect(posts(fake)).toHaveLength(0)
})

test('hiring and people details in a public channel show the amber line while typing', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await topic.composer.fill('The offer for the new backend hire goes out Friday')
  await expect(topic.audienceWarning).toHaveText('This reads like hiring or people detail. eng is a public channel.')
  // It goes as soon as the draft stops matching.
  await topic.composer.fill('The release goes out Friday')
  await expect(topic.audienceWarning).toHaveCount(0)

  // #hiring is private: the same words are fine there.
  await juno.sidebar.row(RINA).open()
  await topic.expectTitle(RINA)
  await topic.composer.fill('The offer for the new backend hire goes out Friday')
  await juno.win.waitForTimeout(800)
  await expect(topic.audienceWarning).toHaveCount(0)
})

test('Enter never waits for a slow model: before its answer the message sends at once, after it the bar shows', async ({ juno, fake, slackApp, userData, running }) => {
  await juno.signIn()
  await juno.waitForSync()
  // A route answer belongs to its topic titles too. Finish initial titles before testing model timing.
  await expect.poll(() => juno.win.locator('[data-topic-row][data-topic-id^="t:C0ENG:"]').evaluateAll(rows =>
    rows.length > 0 && rows.every(row => row.getAttribute('data-title-source') === 'ai'),
  ), { timeout: 15_000 }).toBe(true)
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, fakeAiDelayMillis: 1_000 })
  try {
    const restarted = new Juno(again.app, again.win)
    const { topic } = restarted
    await restarted.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    // Enter while the model is still answering the pause: no bar, no wait.
    await topic.composer.fill(BILL_REPLY)
    await restarted.win.waitForTimeout(500)
    await topic.composer.press('Enter')
    await expect(topic.composer).toHaveValue('', { timeout: 500 })
    await topic.expectSent(BILL_REPLY)
    await expect(topic.checkBar.bar).toHaveCount(0)
    expect(posts(fake)[0]!.args['thread_ts']).toBeUndefined()

    // Once the model has answered, Enter finds the answer and the bar shows.
    const later = `${BILL_REPLY} tonight`
    await typeAndPause(topic, userData, fake.teamId, later)
    await topic.composer.press('Enter')
    await expect(topic.checkBar.bar).toContainText('Looks like a reply to')
    expect(posts(fake)).toHaveLength(1)

    await restarted.tabs.newTabButton.click()
    await restarted.newChat.pickConversation('eng', 'eng')
    await restarted.newChat.write(`${BILL_REPLY} next week`)
    await restarted.win.waitForTimeout(500)
    await restarted.newChat.send()
    await expect(restarted.newChat.root).toHaveCount(0, { timeout: 500 })
    await expect.poll(() => posts(fake).length).toBe(2)
    expect(posts(fake)[1]!.args['thread_ts']).toBeUndefined()
  } finally {
    await again.close()
  }
})

test('with AI assist off, Enter sends at once and nothing is checked', async ({ juno, fake, slackApp, userData, running }) => {
  await juno.signIn()
  await juno.waitForSync()
  await running.close()
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
  db.prepare(`INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run()
  db.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword })
  try {
    const restarted = new Juno(again.app, again.win)
    const { topic } = restarted
    await restarted.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    await topic.composer.fill('The offer for the new backend hire goes out Friday')
    await restarted.win.waitForTimeout(800)
    await expect(topic.audienceWarning).toHaveCount(0)
    await topic.send(BILL_REPLY)
    await topic.expectSent(BILL_REPLY)
    await topic.send(TYPOS)
    await topic.expectSent(TYPOS)
    await expect(topic.checkBar.bar).toHaveCount(0)
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'), { readOnly: true })
    expect(db.prepare(`SELECT count(*) AS n FROM ai_cache WHERE task = 'routeCheck'`).get()).toEqual({ n: 0 })
    db.close()
    expect(posts(fake).map((call) => [call.args['text'], call.args['thread_ts']])).toEqual([
      [BILL_REPLY, undefined],
      [TYPOS, undefined],
    ])
  } finally {
    await again.close()
  }
})

test('New chat checks a channel draft and can post in the suggested thread', async ({ juno, fake, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  await juno.newChat.pickConversation('eng', 'eng')
  const since = Date.now()
  await juno.newChat.write(BILL_REPLY)
  await routeAnswered(userData, fake.teamId, since)
  await juno.newChat.send()
  await expect(juno.newChat.root.getByText('Looks like a reply to', { exact: false })).toBeVisible()
  expect(posts(fake)).toHaveLength(0)
  await juno.newChat.send()
  await expect.poll(() => posts(fake).length).toBe(1)
  expect(posts(fake)[0]!.args['thread_ts']).toBeDefined()
  expect(posts(fake)[0]!.args['text']).toBe(BILL_REPLY)
})

test('New chat offers the same clarity fixes before sending', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  await juno.newChat.pickConversation('eng', 'eng')
  await juno.newChat.write(TYPOS)
  await juno.newChat.send()
  await expect(juno.newChat.root.getByRole('button', { name: 'Fix and send' })).toBeVisible()
  expect(posts(fake)).toHaveLength(0)
  await juno.newChat.send()
  await expect.poll(() => posts(fake).length).toBe(1)
  expect(posts(fake)[0]!.args['text']).toBe(FIXED)
})

test('New chat warns about the audience of the chosen channel', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  await juno.newChat.pickConversation('eng', 'eng')
  await juno.newChat.write('The salary offer goes out Friday')
  await expect(juno.newChat.root.getByText('This reads like hiring or people detail.', { exact: false })).toBeVisible()
  await juno.newChat.pickConversation('hiring', 'hiring')
  await expect(juno.newChat.root.getByText('This reads like hiring or people detail.', { exact: false })).toHaveCount(0)
})
