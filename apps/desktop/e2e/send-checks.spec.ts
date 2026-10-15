// The checks on send (spec section 8) with the fake AI: the wrong-place bar
// in a Main posts in the thread or sends to Main, the clarity bar fixes and
// sends or sends as is, Esc and editing return to the draft, the audience
// line in a public channel, a slow model that times out lets the message
// go, and with AI assist off nothing is checked.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect, launchApp, test } from './fixtures'
import { Juno } from './driver/juno'

test.describe.configure({ timeout: 120_000 })

const ENG_MAIN = '#eng'
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite.'
/** Shares four words with the staging bill thread in #eng. */
const BILL_REPLY = 'the preview environments reaper should cut the staging bill'
const TYPOS = 'can you recieve the the report by friday'
const FIXED = 'can you receive the report by friday?'

const posts = (fake: { calls: ReadonlyArray<{ method: string; args: Record<string, unknown> }> }) => fake.calls.filter((call) => call.method === 'chat.postMessage')

test('a reply typed into Main is offered to its thread, and Post in thread posts it there', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  const root = fake.messages('C0ENG').find((message) => (message.text ?? '').startsWith('Unrelated: has anyone looked at the staging bill'))!
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')

  const field = await topic.composer.boundingBox()
  await topic.send(BILL_REPLY)
  await expect(topic.checkBar.bar).toContainText('Looks like a reply to')
  await expect(topic.checkBar.bar).toContainText('%')
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

test('Send to Main sends it where it was typed', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { topic } = juno
  await juno.sidebar.row(ENG_MAIN).open()
  await topic.expectTitle('Main')
  await topic.send(BILL_REPLY)
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

test('when the model does not answer in time, the message just sends', async ({ juno, fake, slackApp, userData, running }) => {
  await juno.signIn()
  await juno.waitForSync()
  await running.close()

  const again = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, fakeAiDelayMillis: 10_000 })
  try {
    const restarted = new Juno(again.app, again.win)
    const { topic } = restarted
    await restarted.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    const at = Date.now()
    await topic.send(BILL_REPLY)
    await topic.expectSent(BILL_REPLY)
    // The route check gives up at 1.5 s, well before the model's 10 s.
    expect(Date.now() - at).toBeLessThan(5_000)
    await expect(topic.checkBar.bar).toHaveCount(0)
    expect(posts(fake)[0]!.args['thread_ts']).toBeUndefined()
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
    expect(posts(fake).map((call) => [call.args['text'], call.args['thread_ts']])).toEqual([
      [BILL_REPLY, undefined],
      [TYPOS, undefined],
    ])
  } finally {
    await again.close()
  }
})
