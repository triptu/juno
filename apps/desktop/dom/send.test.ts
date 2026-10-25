// Sending from a topic (spec section 8): a message settles in place in Main when Slack's
// echo comes before the answer, a refused send stays with Retry and Delete draft, and a draft
// is kept per topic across tab switches and a restart.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'

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


domTest('in Main, a message settles when the echo comes before the answer, and a refused send stays with Retry and Delete draft', async ({ juno, fake, step }) => {
  const { topic } = juno
  await juno.sidebar.row('#eng').open()
  await topic.expectTitle('Main')

  await step('a message settles when the echo comes before the answer', async () => {
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

  await step('a refused send stays in the row with Retry and Delete draft', async () => {
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

domTest('a draft is kept per topic across tab switches and a restart', async ({ juno, relaunch, userData, fake }) => {
  const { topic, sidebar } = juno
  await sidebar.row(POSTGRES).open()
  await topic.expectTitle(POSTGRES)
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
