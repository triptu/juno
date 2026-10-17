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
async function routeAnswered(userData: string, teamId: string, since: number, task = 'routeCheck'): Promise<void> {
  await expect
    .poll(
      () => {
        const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
        try {
          const row = db.prepare(`SELECT max(CAST(created_at AS INTEGER)) AS at FROM ai_cache WHERE task = ? AND model != ''`).get(task) as { at: number | null }
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

test('local fixes send first and Edit opens a draft without changing the sent message', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.send(TYPOS)
  await juno.topic.expectSent(TYPOS)
  await expect(juno.topic.checkBar.bar).toHaveCount(0)
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toContainText('recieve → receive')
  const row = juno.topic.list.locator('[data-message-row]').filter({ hasText: TYPOS })
  const before = await row.boundingBox()
  await suggestion.getByRole('button', { name: 'Edit', exact: true }).click()
  // The editor replaces the body, so the row no longer has the sent text in it.
  const editor = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(editor).toHaveValue(FIXED)
  expect(posts(fake).map((call) => call.args['text'])).toEqual([TYPOS])
  expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)
  await editor.press('Enter')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.update').length).toBe(1)
  expect(before).not.toBeNull()
})

test('Esc dismisses a post-send suggestion without changing the message or shifting its row', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.send(TYPOS)
  await juno.topic.expectSent(TYPOS)
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toBeVisible()
  const row = juno.topic.list.locator('[data-message-row]').filter({ hasText: TYPOS })
  const before = await row.boundingBox()
  await juno.topic.composer.press('Escape')
  await expect(suggestion).toHaveCount(0)
  expect(await row.boundingBox()).toEqual(before)
  expect(posts(fake).map((call) => call.args['text'])).toEqual([TYPOS])
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
  // Private channels and DMs never warn: audienceCheck in packages/domain/test/checks.test.ts, and Home below.
})

test.describe('with a model slower than the typing pause', () => {
  test.use({ fakeAiDelayMillis: 1_000 })

  test('Enter never waits for a slow model: before its answer the message sends at once, after it the bar shows', async ({ juno, fake, userData }) => {
    await juno.signIn()
    await juno.waitForSync()
    const { topic } = juno
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    // Enter while the model is still answering the pause: no bar, no wait.
    await topic.composer.fill(BILL_REPLY)
    await juno.win.waitForTimeout(500)
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

    await juno.tabs.newTabButton.click()
    await juno.write.pickConversation('eng', 'eng')
    await juno.write.write(`${BILL_REPLY} next week`)
    await juno.win.waitForTimeout(500)
    await juno.write.send()
    await expect(juno.write.composer).toHaveValue('', { timeout: 500 })
    await expect.poll(() => posts(fake).length).toBe(2)
    expect(posts(fake)[1]!.args['thread_ts']).toBeUndefined()
  })
})

test('with AI assist off, local checks still work and models stay off', async ({ juno, fake, slackApp, userData, running }) => {
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
    await expect(restarted.win.locator('[data-send-suggestion]')).toContainText('recieve → receive')
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

test('Home checks a channel draft and can post in the suggested thread', async ({ juno, fake, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  await juno.write.pickConversation('eng', 'eng')
  const since = Date.now()
  await juno.write.write(BILL_REPLY)
  await routeAnswered(userData, fake.teamId, since)
  await juno.write.send()
  await expect(juno.write.root.getByText('Looks like a reply to', { exact: false })).toBeVisible()
  expect(posts(fake)).toHaveLength(0)
  await juno.write.send()
  await expect.poll(() => posts(fake).length).toBe(1)
  expect(posts(fake)[0]!.args['thread_ts']).toBeDefined()
  expect(posts(fake)[0]!.args['text']).toBe(BILL_REPLY)
})

test('Home sends local mistakes unchanged; the fix is offered only on a topic, so Home shows none', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  await juno.write.pickConversation('eng', 'eng')
  await juno.write.write(TYPOS)
  await juno.write.send()
  await expect.poll(() => posts(fake).length).toBe(1)
  expect(posts(fake)[0]!.args['text']).toBe(TYPOS)
  await juno.win.waitForTimeout(1_200)
  await expect(juno.win.locator('[data-send-suggestion]')).toHaveCount(0)
})

test('Home warns about the audience of the chosen channel', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.tabs.newTabButton.click()
  await juno.write.pickConversation('eng', 'eng')
  await juno.write.write('The salary offer goes out Friday')
  await expect(juno.write.root.getByText('This reads like hiring or people detail.', { exact: false })).toBeVisible()
  await juno.write.pickConversation('hiring', 'hiring')
  await expect(juno.write.root.getByText('This reads like hiring or people detail.', { exact: false })).toHaveCount(0)
})


// Lowercase i left alone by default is a clarity rule (packages/domain/test/checks.test.ts).
test('Capital i, turned on in General, flags lowercase i', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings('General')
  const capital = juno.win.getByRole('checkbox', { name: 'Capital i', exact: true })
  await expect(capital).not.toBeChecked()
  await expect(juno.win.getByRole('checkbox', { name: 'Grammar (uses AI)', exact: true })).toBeChecked()
  await juno.win.screenshot({ path: test.info().outputPath('send-checks-settings.png') })
  await capital.check()
  await juno.tabs.close('Settings')
  await juno.openSettings('General')
  await expect(capital).toBeChecked()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.send('i think so too')
  await expect(juno.win.locator('[data-send-suggestion]')).toContainText('i → I')
  expect(posts(fake).map((call) => call.args['text'])).toEqual(['i think so too'])
})

test('grammar offers its broken as an inline edit after sending', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.send('its broken')
  await juno.topic.expectSent('its broken')
  await expect(juno.topic.checkBar.bar).toHaveCount(0)
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toContainText("its → it's")
  await suggestion.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(juno.topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveValue("it's broken")
  expect(posts(fake)[0]!.args['text']).toBe('its broken')
  await juno.topic.list.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)
})

test.describe('with a grammar model slower than the window', () => {
  test.use({ fakeAiDelayMillis: 1_200 })

  test('a slow grammar response never holds Enter or shows a late suggestion', async ({ juno, fake, userData }) => {
    await juno.signIn()
    await juno.waitForSync()
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.send('its broken')
    await expect(juno.topic.composer).toHaveValue('', { timeout: 500 })
    await juno.topic.expectSent('its broken')
    await juno.win.waitForTimeout(1500)
    await expect(juno.win.locator('[data-send-suggestion]')).toHaveCount(0)
    await expect(juno.topic.checkBar.bar).toHaveCount(0)
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'), { readOnly: true })
    try { expect(db.prepare("SELECT count(*) AS n FROM ai_cache WHERE task = 'grammarCheck'").get()).toEqual({ n: 1 }) }
    finally { db.close() }
  })
})

test.describe('with a grammar model still answering when the user leaves', () => {
  test.use({ fakeAiDelayMillis: 600 })

  test('leaving the topic drops a pending grammar result, including after returning', async ({ juno }) => {
    await juno.signIn()
    await juno.waitForSync()
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.send('its broken')
    await juno.sidebar.row(RINA).open()
    await juno.win.waitForTimeout(1100)
    await expect(juno.win.locator('[data-send-suggestion]')).toHaveCount(0)
    await juno.sidebar.row(POSTGRES).open()
    await expect(juno.win.locator('[data-send-suggestion]')).toHaveCount(0)
  })
})

test('Wrong place and grammar can be turned off without disabling local checks', async ({ juno, fake, userData }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings('General')
  await juno.win.getByRole('checkbox', { name: 'Wrong place', exact: true }).uncheck()
  await juno.win.getByRole('checkbox', { name: 'Grammar (uses AI)', exact: true }).uncheck()
  await juno.sidebar.row(ENG_MAIN).open()
  await juno.topic.composer.fill(BILL_REPLY)
  await juno.win.waitForTimeout(900)
  await juno.topic.composer.press('Enter')
  await juno.topic.expectSent(BILL_REPLY)
  await juno.topic.send('its broken')
  await juno.topic.expectSent('its broken')
  await juno.topic.send('teh plan')
  await expect(juno.win.locator('[data-send-suggestion]')).toContainText('teh → the')
  const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'), { readOnly: true })
  try { expect(db.prepare("SELECT count(*) AS n FROM ai_cache WHERE task IN ('routeCheck', 'grammarCheck')").get()).toEqual({ n: 0 }) }
  finally { db.close() }
})
