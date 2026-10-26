// What a relaunch keeps (spec sections 4 and 6): every tab, pinned ones first, their topic drafts,
// each Home tab's draft and destination, the Search tab and privacy mode, and Slack shows the owner active
// at once (SPEC 14); and ⌘W held down after a relaunch closes a tab per press, even on tabs it has not loaded.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { AUTO_AWAY_MILLIS } from '@juno/fake-slack'
import { readUserDb, savedTabs, threadId } from '../e2e/driver/userDb'
import { searchPage } from './driver/palette'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'

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

domTest("a relaunch keeps every tab, pinned ones first, their topic drafts, each Home tab's draft and destination, the Search tab, and privacy mode", async ({ juno, relaunch, userData, fake, slack, step }) => {
  slack.as('Tushar').postIn('eng', 'Pelican migration plan for the queue')
  for (const n of ['one', 'two', 'three']) slack.as('Leo').replyIn('Pelican migration plan', `pelican step ${n} is done`)
  await juno.sidebar.row('Pelican migration plan').expectVisible()
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.composer.fill('Draft one')
  await juno.sidebar.row(RINA).openInNewTab()
  await juno.topic.composer.fill('Draft two')
  await juno.sidebar.row(ROADMAP).openInNewTab()
  await juno.sidebar.row('#eng').openInNewTab()
  await juno.topic.composer.fill('Draft in Main')
  await juno.sidebar.row(POSTGRES).openInNewTab()
  // Two Home tabs, from ⌘-click on Home and from ⌘T, each with its own draft and destination.
  await juno.home.navItem.click({ modifiers: ['Meta'] })
  await expect(juno.tabs.tab('Home')).toHaveCount(1)
  await juno.tabs.selectAt('Home', 0)
  await juno.tabs.expectActiveAt('Home', 0)
  await juno.write.write('First note for Juno')
  await juno.tabs.menu('new-tab')
  await expect(juno.tabs.tab('Home')).toHaveCount(2)
  await juno.tabs.expectActiveAt('Home', 1)
  await expect(juno.write.composer).toHaveValue('')
  await juno.write.pickConversation('product', 'product')
  await juno.write.write('Second, for product')
  // A picked destination and its draft survive a switch to a topic tab and back.
  await juno.tabs.select('Rina')
  await juno.topic.expectTitle(RINA)
  await juno.tabs.selectAt('Home', 1)
  await juno.write.expectDestination('#product')
  await expect(juno.write.composer).toHaveValue('Second, for product')
  await juno.tabs.selectAt('Home', 0)
  await expect(juno.write.composer).toHaveValue('First note for Juno')
  await juno.write.expectDestination('Juno')

  // A Search tab, with its query and a result chosen.
  await juno.tabs.menu('new-tab')
  const page = searchPage(juno.win)
  await juno.surface.appMenu('search-messages')
  await page.field.pressSequentially('pelican')
  await expect(page.rows).toHaveCount(4)
  await page.row('pelican step two is done').click()
  await expect(page.reader.getByText('pelican step two is done')).toBeVisible()

  // A pinned tab goes first.
  await juno.tabs.contextMenu(ROADMAP, 'pin')
  await juno.tabs.expectPinned(ROADMAP)
  await juno.tabs.expectCount(8)
  const before = await juno.tabs.titles()
  expect(before[0]).toMatch(/^Proposal/)
  await juno.tabs.select('Rina')

  // Privacy mode: message text in the sidebar is hidden.
  const { privacy, accountMenu } = juno
  await accountMenu.open()
  await accountMenu.item(/^Hide message text/).click()
  await privacy.expectBlurred(juno.sidebar.row(RINA).preview)
  await expect(privacy.footer).toBeVisible()

  // The eight tabs, with Rina's active, the three topic drafts and both Home drafts are in user.db before the quit.
  await expect
    .poll(() => {
      const state = saved(userData, fake.teamId)
      const rina = state.drafts.get('Draft two')
      const first = state.tabs.find((tab) => tab.homeDraft?.draft === 'First note for Juno')
      const second = state.tabs.find((tab) => tab.homeDraft?.draft === 'Second, for product')
      return state.tabs.length === 8 && rina !== undefined && state.active?.place?.topicId === rina && state.drafts.has('Draft one') && state.drafts.has('Draft in Main')
        && first !== undefined && second?.homeDraft?.conversation !== undefined
    })
    .toBe(true)
  // The Search tab's session has reached the engine.
  await expect.poll(() => readUserDb(userData, fake.teamId, (db) => (db.prepare("SELECT value_json FROM prefs WHERE key = 'tabs'").get() as { value_json: string } | undefined)?.value_json ?? '')).toMatch(/"search":\{"text":"pelican".*"selected":.*"panel":true/)
  // Closed long enough that Slack's own timeout shows the owner away.
  const restarted = await relaunch({ whileClosed: () => { fake.advanceClock({ millis: AUTO_AWAY_MILLIS + 60_000 }) } })

  await step('Slack shows the owner active as soon as Juno is open, not at the next activity poll', async () => {
    await expect(restarted.sidebar.accountButton.locator('[data-presence="active"]')).toHaveCount(1)
  })

  await step('privacy mode is still on from the first render, and the footer turns it off', async () => {
    await expect(restarted.privacy.footer).toBeVisible()
    expect(restarted.win.document.documentElement.hasAttribute('data-privacy')).toBe(true)
    const rina = restarted.sidebar.row(RINA)
    await rina.expectVisible()
    await restarted.privacy.expectBlurred(rina.preview)
    await restarted.privacy.showButton.click()
    await expect(restarted.privacy.footer).toHaveCount(0)
    await restarted.privacy.expectBlurred(rina.preview, false)
  })

  await step('every tab is back in its order, the pinned one first, with its draft', async () => {
    await restarted.tabs.expectCount(8)
    await expect.poll(() => restarted.tabs.titles()).toEqual(before)
    await restarted.tabs.expectActive('Rina')
    await expect(restarted.topic.composer).toHaveValue('Draft two', { timeout: 15_000 })
    await restarted.tabs.selectAt(POSTGRES, 0)
    await restarted.tabs.expectActiveAt(POSTGRES, 0)
    await expect(restarted.topic.composer).toHaveValue('Draft one', { timeout: 15_000 })
    await restarted.tabs.select('eng')
    await restarted.tabs.expectActive('eng')
    await expect(restarted.topic.composer).toHaveValue('Draft in Main', { timeout: 15_000 })
    await restarted.tabs.selectAt(POSTGRES, 1)
    await restarted.tabs.expectActiveAt(POSTGRES, 1)
    await expect(restarted.topic.composer).toHaveValue('Draft one', { timeout: 15_000 })
    await restarted.tabs.selectAt('Home', 0)
    await restarted.tabs.expectActiveAt('Home', 0)
    await expect(restarted.write.composer).toHaveValue('First note for Juno')
    await restarted.write.expectDestination('Juno')
    await restarted.tabs.selectAt('Home', 1)
    await restarted.tabs.expectActiveAt('Home', 1)
    await restarted.write.expectDestination('#product')
    await expect(restarted.write.composer).toHaveValue('Second, for product')
    await restarted.tabs.expectPinned(ROADMAP)
    await restarted.tabs.expectPinned(POSTGRES, false)
  })

  await step('the Search tab comes back with its query, its selection and the topic beside it', async () => {
    await restarted.tabs.select('pelican')
    const again = searchPage(restarted.win)
    await expect(again.field).toHaveValue('pelican')
    await expect(again.row('pelican step two is done')).toHaveAttribute('aria-selected', 'true')
    await expect(again.reader.getByText('pelican step two is done')).toBeVisible()
  })
}, { timeout: 120_000 })

domTest('⌘W held down closes a tab per press, even when the tabs it lands on were put away', async ({ juno, relaunch, userData, fake, slack }) => {
  const { sidebar, tabs } = juno
  const topics = [POSTGRES, RINA, ROADMAP, OFFSITE, 'Unrelated: has anyone looked at the', 'p95 on /v2/search jumped to 1.8s', 'Two options for the thread list', 'Final copy for pricing is in']
  await sidebar.row(topics[0]!).open()
  for (const title of topics.slice(1)) await sidebar.row(title).openInNewTab()
  await tabs.menu('tab-1')
  await tabs.expectActive(POSTGRES)
  // The save has reached the engine.
  await expect.poll(() => savedTabs(userData, fake.teamId)).toEqual({ tabs: topics.map((title) => ({ place: threadId(slack, title), pinned: false })), active: 0 })
  // After a relaunch only the active tab has its topic loaded, so showing any other one waits for the engine.
  const restarted = await relaunch()
  await restarted.tabs.expectCount(topics.length)
  await restarted.tabs.expectActive(POSTGRES)
  // Three presses in one go, as the key repeats.
  await restarted.surface.appMenu('close-tab', 3)
  await restarted.tabs.expectCount(topics.length - 3)
  await expect.poll(() => savedTabs(userData, fake.teamId)?.tabs.length).toBe(topics.length - 3)
  expect(await restarted.tabs.titles()).not.toContain(expect.stringMatching(/^Draft plan/))
})
