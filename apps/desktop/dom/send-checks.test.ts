// Send checks (SPEC 8, "Send checks"): wrong place, the audience line, local fixes after
// sending and the grammar model, from a topic and from Home. Every test has the test clock,
// so a slow fake model's delay passes when the test moves time.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { FakeSlack } from '@juno/fake-slack'
import type { PageClock } from './clock'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest, type DomContext } from './test'

const ENG_MAIN = '#eng'
const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
/** Shares four words with the staging bill thread in #eng. */
const BILL_REPLY = 'the preview environments reaper should cut the staging bill'
const TYPOS = 'can you recieve the the report by friday'
const FIXED = 'can you receive the report by friday?'
const DOUBLED = 'I think the the build is green'

function cacheCount(userData: string, teamId: string, sql: string): number {
  const db = new DatabaseSync(join(userData, 'workspaces', teamId, 'cache.db'), { readOnly: true })
  try { return (db.prepare(sql).get() as { n: number }).n }
  finally { db.close() }
}

/**
 * Waits until the model has answered a `task` asked at or after `since` (the
 * engine's time, which follows the page's clock), moving time so a slow
 * model's delay passes.
 */
async function answered(clock: PageClock, userData: string, teamId: string, since: number, task = 'routeCheck'): Promise<void> {
  await expect.poll(async () => {
    await clock.fastForward(250)
    return cacheCount(userData, teamId, `SELECT coalesce(max(CAST(created_at AS INTEGER)), 0) AS n FROM ai_cache WHERE task = '${task}' AND model != ''`)
  }, { timeout: 15_000 }).toBeGreaterThanOrEqual(since)
}

/** Types a draft and waits for the typing pause's wrong-place answer. */
async function typeAndPause({ juno, clock, userData, fake }: Pick<DomContext, 'juno' | 'clock' | 'userData' | 'fake'>, text: string): Promise<void> {
  const since = clock.now()
  await juno.topic.composer.fill(text)
  await answered(clock, userData, fake.teamId, since)
}

/** The "+" after the last tab, once the new Home is the active tab. */
async function newHome(juno: Juno): Promise<void> {
  const count = juno.tabs.root.getByRole('tab').count()
  await juno.tabs.newTabButton.click()
  await juno.tabs.expectCount(count + 1)
  await juno.tabs.expectActiveAt('Home', juno.tabs.tab('Home').count() - 1)
}

const posts = (fake: FakeSlack) => fake.calls.filter((call) => call.method === 'chat.postMessage')
const suggestion = (juno: Juno) => juno.win.locator('[data-send-suggestion]')

// One launch with the test clock. Wrong place in Main goes first, with no post before it; the switches and AI
// assist off go last, since they turn checks off.
domTest('wrong place, the audience line, local fixes and grammar after sending, from a topic and from Home; the switches and AI assist off turn the models off, not the local checks', async ({ juno, fake, userData, clock, relaunch, step }) => {
  const context = { juno, fake, userData, clock }
  const { topic } = juno
  await step('a reply typed into Main is offered to its thread: Post in thread posts it there, Send to Main where it was typed, and hiring details show the amber line', async () => {
    const root = fake.messages('C0ENG').find((message) => (message.text ?? '').startsWith('Unrelated: has anyone looked at the staging bill'))!
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')

    await step('Post in thread posts it there', async () => {
      await typeAndPause(context, BILL_REPLY)
      await topic.composer.press('Enter')
      await expect(topic.checkBar.bar).toContainText('Looks like a reply to')
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

    await step('Send to Main sends it where it was typed', async () => {
      const again = `${BILL_REPLY} tonight`
      await typeAndPause(context, again)
      await topic.composer.press('Enter')
      await topic.checkBar.choose('Send to Main')
      await topic.expectSent(again)
      expect(posts(fake)).toHaveLength(2)
      expect(posts(fake)[1]!.args['thread_ts']).toBeUndefined()
      await expect(topic.composer).toBeFocused()
    })

    await step('hiring and people details in a public channel show the amber line while typing', async () => {
      await topic.composer.fill('The offer for the new backend hire goes out Friday')
      await expect(topic.audienceWarning).toBeVisible()
      // It goes as soon as the draft stops matching.
      await topic.composer.fill('The release goes out Friday')
      await expect(topic.audienceWarning).toHaveCount(0)
      await topic.composer.fill('')
      // Private channels and DMs never warn: audienceCheck in packages/domain/test/checks.test.ts, and Home's test below.
    })
  })

  await step('local fixes show after sending: Review opens a draft without changing the sent message, and Dismiss stays away', async () => {
    fake.resetCalls()
    await juno.sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)

    await step('local fixes send first and Review opens a draft without changing the sent message', async () => {
      await topic.send(TYPOS)
      await topic.expectSent(TYPOS)
      await expect(topic.checkBar.bar).toHaveCount(0)
      await expect(suggestion(juno)).toContainText('recieve → receive')
      // The line is part of the sent message's row, under its text.
      await expect(topic.message(TYPOS).locator('[data-send-suggestion]')).toHaveCount(1)
      await suggestion(juno).getByRole('button', { name: 'Review', exact: true }).click()
      const editor = topic.list.getByRole('textbox', { name: 'Edit message' })
      await expect(editor).toHaveValue(FIXED)
      expect(posts(fake).map((call) => call.args['text'])).toEqual([TYPOS])
      expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)
      await editor.press('Enter')
      await expect.poll(() => fake.calls.filter((call) => call.method === 'chat.update').length).toBe(1)
      await expect(suggestion(juno)).toHaveCount(0)
    })

    await step('Dismiss removes the fix line without changing the message, and it stays away', async () => {
      fake.resetCalls()
      await topic.send(DOUBLED)
      await topic.expectSent(DOUBLED)
      await expect(suggestion(juno)).toContainText('the the → the')
      // Esc in the composer leaves it: only Review and Dismiss close it.
      await topic.composer.press('Escape')
      await expect(suggestion(juno)).toBeVisible()
      await suggestion(juno).getByRole('button', { name: 'Dismiss', exact: true }).click()
      await expect(suggestion(juno)).toHaveCount(0)
      await juno.sidebar.row(RINA).open()
      await juno.sidebar.row(POSTGRES).open()
      await topic.expectSent(DOUBLED)
      await expect(suggestion(juno)).toHaveCount(0)
      expect(posts(fake).map((call) => call.args['text'])).toEqual([DOUBLED])
    })
  })

  await step('Home checks a channel draft and can post in the suggested thread', async () => {
    fake.resetCalls()
    await newHome(juno)
    await juno.write.pickConversation('eng', 'eng')
    const since = clock.now()
    await juno.write.write(BILL_REPLY)
    await answered(clock, userData, fake.teamId, since)
    await juno.write.send()
    await expect(juno.write.root.getByText('Looks like a reply to', { exact: false })).toBeVisible()
    expect(posts(fake)).toHaveLength(0)
    await juno.write.send()
    await expect.poll(() => posts(fake).length).toBe(1)
    expect(posts(fake)[0]!.args['thread_ts']).toBeDefined()
    expect(posts(fake)[0]!.args['text']).toBe(BILL_REPLY)
  })
  await step('Home warns about the audience of the chosen channel', async () => {
    await newHome(juno)
    await juno.write.pickConversation('eng', 'eng')
    await juno.write.write('The salary offer goes out Friday')
    const warning = juno.write.root.locator('[data-audience-warning]')
    await expect(warning).toBeVisible()
    await juno.write.pickConversation('hiring', 'hiring')
    await expect(warning).toHaveCount(0)
  })
  await step('Home sends local mistakes unchanged; the fix line waits on the message in its topic', async () => {
    await newHome(juno)
    await juno.write.pickConversation('eng', 'eng')
    await juno.write.write(TYPOS)
    await juno.write.send()
    await expect.poll(() => posts(fake).length).toBe(2)
    expect(posts(fake)[1]!.args['text']).toBe(TYPOS)
    await clock.fastForward(1_200)
    await expect(suggestion(juno)).toHaveCount(0)
    await juno.sidebar.row(ENG_MAIN).open()
    await juno.topic.expectSent(TYPOS)
    await expect(suggestion(juno)).toContainText('recieve → receive')
  })

  await step('grammar offers its broken as an inline edit after sending, and asks nothing while typing', async () => {
    fake.resetCalls()
    const asked = cacheCount(userData, fake.teamId, "SELECT count(*) AS n FROM ai_cache WHERE task = 'grammarCheck'")
    const grammarRows = () => cacheCount(userData, fake.teamId, "SELECT count(*) AS n FROM ai_cache WHERE task = 'grammarCheck'") - asked
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.composer.fill('its broken')
    // Past the typing pause: grammar has not been asked.
    await clock.fastForward(1_000)
    expect(grammarRows()).toBe(0)
    await juno.topic.composer.press('Enter')
    await juno.topic.expectSent('its broken')
    await expect(juno.topic.checkBar.bar).toHaveCount(0)
    await expect(suggestion(juno)).toContainText("its → it's")
    expect(grammarRows()).toBe(1)
    await suggestion(juno).getByRole('button', { name: 'Review', exact: true }).click()
    await expect(juno.topic.list.getByRole('textbox', { name: 'Edit message' })).toHaveValue("it's broken")
    expect(posts(fake)[0]!.args['text']).toBe('its broken')
    await juno.topic.list.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(fake.calls.filter((call) => call.method === 'chat.update')).toHaveLength(0)
  })

  const checkbox = (name: string) => juno.win.getByRole('checkbox', { name, exact: true })
  fake.resetCalls()
  const modelRows = () => cacheCount(userData, fake.teamId, "SELECT count(*) AS n FROM ai_cache WHERE task IN ('routeCheck', 'grammarCheck')")
  const asked = modelRows()
  await step('the switches start as they ship and keep what is set', async () => {
    await juno.openSettings('General')
    await expect(checkbox('Capital i')).toBeChecked({ checked: false })
    await expect(checkbox('Grammar (uses AI)')).toBeChecked()
    await checkbox('Capital i').check()
    await checkbox('Wrong place').uncheck()
    await checkbox('Grammar (uses AI)').uncheck()
    await juno.tabs.close('Settings')
    await juno.openSettings('General')
    await expect(checkbox('Capital i')).toBeChecked()
  })
  await step('Capital i flags lowercase i', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.send('i think so too')
    await expect(suggestion(juno)).toContainText('i → I')
  })
  await step('with Wrong place and grammar off, a reply-like draft sends at once and local fixes still show', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await juno.topic.expectTitle('Main')
    await juno.topic.composer.fill(BILL_REPLY)
    await clock.fastForward(900)
    await juno.topic.composer.press('Enter')
    await juno.topic.expectSent(BILL_REPLY)
    await juno.topic.send('its broken')
    await juno.topic.expectSent('its broken')
    await juno.topic.send('teh plan')
    await expect(suggestion(juno).last()).toContainText('teh → the')
    // The fix line is local and can show before the post reaches Slack.
    await expect.poll(() => posts(fake).map((call) => call.args['text'])).toEqual(['i think so too', BILL_REPLY, 'its broken', 'teh plan'])
    expect(modelRows()).toBe(asked)
  })

  await step('with AI assist off, local checks still work and models stay off', async () => {
    // Back on, so AI assist alone decides once the relaunch reads it off.
    await juno.openSettings('General')
    await juno.win.getByRole('checkbox', { name: 'Wrong place', exact: true }).check()
    await juno.win.getByRole('checkbox', { name: 'Grammar (uses AI)', exact: true }).check()
    const routeChecks = cacheCount(userData, fake.teamId, `SELECT count(*) AS n FROM ai_cache WHERE task = 'routeCheck'`)
    const restarted = await relaunch({
      whileClosed: () => {
        const db = new DatabaseSync(join(userData, 'workspaces', fake.teamId, 'user.db'))
        db.prepare(`INSERT INTO prefs (key, value_json) VALUES ('aiAssist', 'false') ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`).run()
        db.close()
      },
    })
    const { topic } = restarted
    // New words: the same Main already holds the earlier sends.
    const AFTER = `${BILL_REPLY} after the relaunch`
    const TYPOS_AFTER = 'can you recieve the notes by monday'
    fake.resetCalls()
    await restarted.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    await topic.composer.fill('The offer for the new backend hire goes out Friday')
    await clock.fastForward(800)
    await expect(topic.audienceWarning).toHaveCount(0)
    await topic.send(AFTER)
    await topic.expectSent(AFTER)
    await topic.send(TYPOS_AFTER)
    await expect(suggestion(restarted).last()).toContainText('recieve → receive')
    await topic.expectSent(TYPOS_AFTER)
    await expect(topic.checkBar.bar).toHaveCount(0)
    expect(cacheCount(userData, fake.teamId, `SELECT count(*) AS n FROM ai_cache WHERE task = 'routeCheck'`)).toBe(routeChecks)
    expect(posts(fake).map((call) => [call.args['text'], call.args['thread_ts']])).toEqual([
      [AFTER, undefined],
      [TYPOS_AFTER, undefined],
    ])
  })
}, { clock: true, timeout: 120_000 })

// The model answers five seconds after it is asked, on the test clock.
domTest('Enter never waits for a slow model, and a slow grammar fix joins the local one when it comes, even after leaving the topic', async ({ juno, fake, userData, clock, step }) => {
  const context = { juno, fake, userData, clock }
  const { topic } = juno
  await step('before the model answers the message sends at once, after it the bar shows, and Home sends at once too', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await topic.expectTitle('Main')
    // Enter while the model is still answering the pause: no bar, no wait.
    await topic.composer.fill(BILL_REPLY)
    await clock.fastForward(500)
    await topic.composer.press('Enter')
    await expect(topic.composer).toHaveValue('', { timeout: 500 })
    await topic.expectSent(BILL_REPLY)
    await expect(topic.checkBar.bar).toHaveCount(0)
    expect(posts(fake)[0]!.args['thread_ts']).toBeUndefined()

    // Once the model has answered, Enter finds the answer and the bar shows.
    const later = `${BILL_REPLY} tonight`
    await typeAndPause(context, later)
    await topic.composer.press('Enter')
    await expect(topic.checkBar.bar).toContainText('Looks like a reply to')
    expect(posts(fake)).toHaveLength(1)

    await newHome(juno)
    await juno.write.pickConversation('eng', 'eng')
    await juno.write.write(`${BILL_REPLY} next week`)
    await clock.fastForward(500)
    await juno.write.send()
    await expect(juno.write.composer).toHaveValue('', { timeout: 500 })
    await expect.poll(() => posts(fake).length).toBe(2)
    expect(posts(fake)[1]!.args['thread_ts']).toBeUndefined()
  })

  await step('a doubled word shows at once, and the grammar fix joins it when it comes, even after leaving the topic', async () => {
    fake.resetCalls()
    await juno.sidebar.row(POSTGRES).open()
    const text = 'its broken, I think the the build is red'
    const sent = clock.now()
    await juno.topic.send(text)
    await expect(juno.topic.composer).toHaveValue('', { timeout: 500 })
    await juno.topic.expectSent(text)
    // The local rule answers before the model.
    await expect(suggestion(juno)).toContainText('the the → the')
    await expect(suggestion(juno)).not.toContainText("its → it's")
    // The answer comes while another topic shows: nothing appears there.
    await juno.sidebar.row(RINA).open()
    await answered(clock, userData, fake.teamId, sent, 'grammarCheck')
    await expect(suggestion(juno)).toHaveCount(0)
    await juno.sidebar.row(POSTGRES).open()
    await expect(suggestion(juno)).toContainText("its → it's")
    await expect(suggestion(juno)).toContainText('the the → the')
    await expect(juno.topic.checkBar.bar).toHaveCount(0)
    expect(posts(fake).map((call) => call.args['text'])).toEqual([text])
  })
}, { clock: true, engine: { fakeAiDelayMillis: 5_000 } })
