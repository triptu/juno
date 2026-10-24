import type { Fixtures } from './fixtures'

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true, freshContext: true })

test.describe.configure({ timeout: 120_000 })

test.beforeEach(async ({ win }) => { await win.clock.install() })

const ENG_MAIN = '#eng'
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
/** Shares four words with the staging bill thread in #eng. */
const BILL_REPLY = 'the preview environments reaper should cut the staging bill'
const TYPOS = 'can you recieve the the report by friday'
const FIXED = 'can you receive the report by friday?'
const DOUBLED = 'I think the the build is green'

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

/** How many grammar requests the cache holds, answered or not. */
function grammarRows(userData: string, teamId: string): number {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
  try { return (db.prepare("SELECT count(*) AS n FROM ai_cache WHERE task = 'grammarCheck'").get() as { n: number }).n }
  finally { db.close() }
}

test('a reply typed into Main is offered to its thread, and Post in thread posts it there', async ({ juno, fake, userData }) => {
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

// Send to Main goes first: the amber step's drafts start wrong-place checks of their own, and one asked
// after the next draft was typed would pass for its answer.
test("Send to Main sends a checked draft where it was typed, and hiring details in #eng's Main show the amber line", async ({ juno, fake, userData }) => {
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await test.step('Send to Main sends it where it was typed', async () => {
    await typeAndPause(topic, userData, fake.teamId, BILL_REPLY)
    await topic.composer.press('Enter')
    await topic.checkBar.choose('Send to Main')
    await topic.expectSent(BILL_REPLY)
    expect(posts(fake)).toHaveLength(1)
    expect(posts(fake)[0]!.args['thread_ts']).toBeUndefined()
    await expect(topic.composer).toBeFocused()
  })
  await test.step('hiring and people details in a public channel show the amber line while typing', async () => {
    await topic.composer.fill('The offer for the new backend hire goes out Friday')
    await expect(topic.audienceWarning).toHaveText('This reads like hiring or people detail. eng is a public channel.')
    // It goes as soon as the draft stops matching.
    await topic.composer.fill('The release goes out Friday')
    await expect(topic.audienceWarning).toHaveCount(0)
    // Private channels and DMs never warn: audienceCheck in packages/domain/test/checks.test.ts, and Home below.
  })
})

test('reviews local fixes, dismisses them and corrects a doubled word', async ({ juno, fake }) => {
  const context = { juno, fake }
  await test.step('local fixes send first and Review opens a draft without changing the sent message', () => reviewLocalFixes(context))
  await test.step('Dismiss removes the fix line without changing the message, and it stays away', () => dismissLocalFixes(context))
  await test.step('a doubled word is offered as a fix after sending', () => reviewDoubledWord(context))
})

async function reviewLocalFixes({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.send(TYPOS)
  await juno.topic.expectSent(TYPOS)
  await expect(juno.topic.checkBar.bar).toHaveCount(0)
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toContainText('recieve → receive')
  await expect(suggestion).toContainText('3 small fixes')
  // The line is part of the sent message's row, under its text.
  const row = juno.topic.list.locator('[data-message-row]').filter({ hasText: TYPOS })
  await expect(row.locator('[data-send-suggestion]')).toHaveCount(1)
  await suggestion.getByRole('button', { name: 'Review', exact: true }).click()
  // The editor replaces the body, so the row no longer has the sent text in it.
  const editor = juno.topic.list.getByRole('textbox', { name: 'Edit message' })
  await expect(editor).toHaveValue(FIXED)
  expect(posts(fake).map((call) => call.args['text'])).toEqual([TYPOS])
  expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)
  await editor.press('Enter')
  await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.update').length).toBe(1)
  await expect(suggestion).toHaveCount(0)
}

async function dismissLocalFixes({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.send(TYPOS)
  await juno.topic.expectSent(TYPOS)
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toBeVisible()
  // Esc in the composer leaves it: only Review and Dismiss close it.
  await juno.topic.composer.press('Escape')
  await expect(suggestion).toBeVisible()
  await suggestion.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(suggestion).toHaveCount(0)
  await juno.sidebar.row(RINA).open()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectSent(TYPOS)
  await expect(suggestion).toHaveCount(0)
  expect(posts(fake).map((call) => call.args['text'])).toEqual([TYPOS])
}

async function reviewDoubledWord({ juno, fake }: Pick<Fixtures, 'juno' | 'fake'>): Promise<void> {
  fake.resetCalls()

  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.send(DOUBLED)
  await juno.topic.expectSent(DOUBLED)
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toContainText('the the → the')
  await suggestion.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(juno.topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveValue('I think the build is green')
  expect(posts(fake).map((call) => call.args['text'])).toEqual([DOUBLED])
}

test.describe('with a model slower than the typing pause', () => {
  test.use({ fakeAiDelayMillis: 1_000 })

  test('Enter never waits for a slow model: before its answer the message sends at once, after it the bar shows', async ({ juno, fake, userData }) => {
    const { topic } = juno
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    // Enter while the model is still answering the pause: no bar, no wait.
    await topic.composer.fill(BILL_REPLY)
    await juno.win.clock.fastForward(500)
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
    await juno.win.clock.fastForward(500)
    await juno.write.send()
    await expect(juno.write.composer).toHaveValue('', { timeout: 500 })
    await expect.poll(() => posts(fake).length).toBe(2)
    expect(posts(fake)[1]!.args['thread_ts']).toBeUndefined()
  })
})

test('with AI assist off, local checks still work and models stay off', async ({ fake, userData, relaunch }) => {
  const restarted = await relaunch({
    whileClosed: () => {
      const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
      db.prepare(`INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run()
      db.close()
    },
  })
  const { topic } = restarted
  await restarted.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await topic.composer.fill('The offer for the new backend hire goes out Friday')
  await restarted.win.clock.fastForward(800)
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

})

// The thread suggestion goes first, for the same reason: the audience step's drafts start wrong-place checks.
test('Home checks a channel draft, posts in the suggested thread, warns about the audience, and sends local mistakes unchanged', async ({ juno, fake, userData }) => {
  await test.step('Home checks a channel draft and can post in the suggested thread', async () => {
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
  await test.step('Home warns about the audience of the chosen channel', async () => {
    await juno.tabs.newTabButton.click()
    await juno.write.pickConversation('eng', 'eng')
    await juno.write.write('The salary offer goes out Friday')
    await expect(juno.write.root.getByText('This reads like hiring or people detail.', { exact: false })).toBeVisible()
    await juno.write.pickConversation('hiring', 'hiring')
    await expect(juno.write.root.getByText('This reads like hiring or people detail.', { exact: false })).toHaveCount(0)
  })
  await test.step('Home sends local mistakes unchanged; the fix line waits on the message in its topic', async () => {
    await juno.tabs.newTabButton.click()
    await juno.write.pickConversation('eng', 'eng')
    await juno.write.write(TYPOS)
    await juno.write.send()
    await expect.poll(() => posts(fake).length).toBe(2)
    expect(posts(fake)[1]!.args['text']).toBe(TYPOS)
    await juno.win.clock.fastForward(1_200)
    await expect(juno.win.locator('[data-send-suggestion]')).toHaveCount(0)
    await juno.sidebar.row(ENG_MAIN).open()
    await juno.topic.expectSent(TYPOS)
    await expect(juno.win.locator('[data-send-suggestion]')).toContainText('recieve → receive')
  })
})

test('a message with a mention gets its fix line, and Review opens it as the field showed it', async ({ juno, fake }) => {
  const { topic } = juno
  await juno.sidebar.row(POSTGRES).open()
  await topic.composer.pressSequentially('Thanks @ma')
  await expect(topic.suggestion('Maya')).toBeVisible()
  await topic.composer.press('Enter')
  await topic.composer.pressSequentially('the the build is green')
  await topic.composer.press('Enter')
  await topic.expectSent('Thanks')
  expect(posts(fake).map((call) => call.args['text'])).toEqual(['Thanks <@U0MAYA> the the build is green'])
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toContainText('the the → the')
  await suggestion.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveValue('Thanks @Maya the build is green')
})

test('grammar offers its broken as an inline edit after sending, and asks nothing while typing', async ({ juno, fake, userData }) => {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.composer.fill('its broken')
  // Past the typing pause: grammar has not been asked.
  await juno.win.clock.fastForward(1_000)
  expect(grammarRows(userData, fake.teamId)).toBe(0)
  await juno.topic.composer.press('Enter')
  await juno.topic.expectSent('its broken')
  await expect(juno.topic.checkBar.bar).toHaveCount(0)
  const suggestion = juno.win.locator('[data-send-suggestion]')
  await expect(suggestion).toContainText("its → it's")
  expect(grammarRows(userData, fake.teamId)).toBe(1)
  await suggestion.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(juno.topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveValue("it's broken")
  expect(posts(fake)[0]!.args['text']).toBe('its broken')
  await juno.topic.list.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)
})

test.describe('with a grammar model that takes 5 seconds', () => {
  test.use({ fakeAiDelayMillis: 5_000 })

  test('Enter never waits, local doubled words show at once, and the grammar fix joins them when it comes', async ({ juno, fake }) => {
    await juno.sidebar.row(POSTGRES).open()
    const text = 'its broken, I think the the build is red'
    await juno.topic.send(text)
    await expect(juno.topic.composer).toHaveValue('', { timeout: 500 })
    await juno.topic.expectSent(text)
    const suggestion = juno.win.locator('[data-send-suggestion]')
    // The local rule answers well before the model.
    await expect(suggestion).toContainText('the the → the', { timeout: 2_000 })
    await expect(suggestion).not.toContainText("its → it's")
    await expect(suggestion).toContainText('2 small fixes', { timeout: 15_000 })
    await expect(suggestion).toContainText("its → it's")
    await expect(juno.topic.checkBar.bar).toHaveCount(0)
    expect(posts(fake).map((call) => call.args['text'])).toEqual([text])
  })

  test('a slow grammar answer shows its fix line after leaving the topic and coming back', async ({ juno, fake, userData }) => {
    await juno.sidebar.row(POSTGRES).open()
    const since = Date.now()
    await juno.topic.send('its broken')
    await juno.topic.expectSent('its broken')
    await juno.sidebar.row(RINA).open()
    // The answer comes while another topic shows: nothing appears there.
    await routeAnswered(userData, fake.teamId, since, 'grammarCheck')
    await expect(juno.win.locator('[data-send-suggestion]')).toHaveCount(0)
    await juno.sidebar.row(POSTGRES).open()
    await expect(juno.win.locator('[data-send-suggestion]')).toContainText("its → it's")
  })
})

// Lowercase i left alone by default is a clarity rule (packages/domain/test/checks.test.ts).
test('the send check switches in General: Capital i flags lowercase i, and Wrong place and grammar turn off without the local checks', async ({ juno, fake, userData }) => {
  await test.step('the switches start as they ship and keep what is set', async () => {
    await juno.openSettings('General')
    const capital = juno.win.getByRole('checkbox', { name: 'Capital i', exact: true })
    await expect(capital).not.toBeChecked()
    await expect(juno.win.getByRole('checkbox', { name: 'Grammar (uses AI)', exact: true })).toBeChecked()
    await capital.check()
    await juno.win.getByRole('checkbox', { name: 'Wrong place', exact: true }).uncheck()
    await juno.win.getByRole('checkbox', { name: 'Grammar (uses AI)', exact: true }).uncheck()
    await juno.tabs.close('Settings')
    await juno.openSettings('General')
    await expect(capital).toBeChecked()
  })
  await test.step('Capital i flags lowercase i', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.send('i think so too')
    await expect(juno.win.locator('[data-send-suggestion]')).toContainText('i → I')
  })
  await test.step('with Wrong place and grammar off, a reply-like draft sends at once and local fixes still show', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await juno.topic.composer.fill(BILL_REPLY)
    await juno.win.clock.fastForward(900)
    await juno.topic.composer.press('Enter')
    await juno.topic.expectSent(BILL_REPLY)
    await juno.topic.send('its broken')
    await juno.topic.expectSent('its broken')
    await juno.topic.send('teh plan')
    await expect(juno.win.locator('[data-send-suggestion]')).toContainText('teh → the')
    expect(posts(fake).map((call) => call.args['text'])).toEqual(['i think so too', BILL_REPLY, 'its broken', 'teh plan'])
    const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'cache.db'), { readOnly: true })
    try { expect(db.prepare("SELECT count(*) AS n FROM ai_cache WHERE task IN ('routeCheck', 'grammarCheck')").get()).toEqual({ n: 0 }) }
    finally { db.close() }
  })
})
