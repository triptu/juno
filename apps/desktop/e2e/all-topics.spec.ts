// The All topics page (SPEC 11, inventory 10) against the fake Slack: it
// lists what the sidebar leaves out (quiet, resolved, unfollowed and
// never-followed topics), every filter narrows it, a row opens its topic in
// the tab, and the row menu's actions work here with their undo.
import { expect, test, type Fixtures } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 90_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const QUIET = 'Lag alerts are firing on the'
const FLAGS = 'We have 142 flags.'
const ROADMAP = 'Proposal: cut offline mode and public'
const POSTGRES = 'Draft plan is in the doc'
const STAGING = 'Unrelated: has anyone looked at the'
const DESIGN = 'Two options for the thread list'
// A thread in the DM with Maya.
const OFFSITE = 'Can eng take the Wednesday afternoon'

test('lists quiet, resolved and never-followed topics, and a row opens its topic in the tab', async ({ juno }) => {
  const { sidebar, allTopics, tabs } = juno

  // A quiet topic and a thread nobody followed are not in the sidebar.
  await sidebar.row(QUIET).expectAbsent()
  await sidebar.row(FLAGS).expectAbsent()

  // Resolved from the sidebar, it leaves the sidebar too.
  await sidebar.row(ROADMAP).chooseInMenu('resolve')
  await sidebar.row(ROADMAP).expectAbsent()

  await allTopics.open()
  await tabs.expectActive('All topics')
  await expect(allTopics.navItem).toHaveAttribute('aria-current', 'page')
  await allTopics.row(QUIET).expectStatus('Quiet')
  await allTopics.row(FLAGS).expectStatus('Open')
  await allTopics.row(ROADMAP).expectStatus('Resolved')
  await allTopics.row(POSTGRES).expectWhere('eng')

  // A plain open of the page again focuses the tab that shows it.
  await allTopics.open()
  await tabs.expectCount(1)

  // Opening a row shows the topic in the same tab; Back returns to the page.
  await allTopics.row(QUIET).open()
  await juno.topic.expectTitle(/Lag alerts are firing on the/)
  await tabs.expectCount(1)
  await juno.nav.back()
  await tabs.expectActive('All topics')
  await allTopics.row(QUIET).expectVisible()

  // ⌘-click opens it in a new tab and keeps the page.
  await allTopics.row(FLAGS).open({ newTab: true })
  await tabs.expectCount(2)
  await juno.topic.expectTitle(/We have 142 flags/)
})

test('filters all topics by status, kind, text and place, then acts on rows with Undo', async ({ juno, slack }) => {
  const context = { juno, slack }
  await test.step('each filter narrows the list: status chips, kind, sort and text', () => filterTopics(context))
  await test.step('the place picker searches conversations by word, and a pick narrows the list', () => pickTopicPlace(context))
  await test.step('the row menu works from All topics, each action with its undo', () => actOnTopicRows(context))
})

async function filterTopics({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const { allTopics } = juno
  await allTopics.open()

  // Status chips, with their counts.
  await allTopics.filterStatus('Quiet')
  await allTopics.row(QUIET).expectVisible()
  await allTopics.row(POSTGRES).expectAbsent()
  for (const title of await allTopics.titles()) expect(title).not.toBe('')
  await allTopics.filterStatus('Open')
  await allTopics.row(POSTGRES).expectVisible()
  await allTopics.row(QUIET).expectAbsent()
  await allTopics.filterStatus('Resolved')
  await allTopics.expectEmpty()
  await allTopics.expectCount('Resolved', 0)
  await allTopics.filterStatus('All')

  // Kind: DMs only, then channels only.
  await allTopics.filterKind('DMs')
  await allTopics.row(POSTGRES).expectAbsent()
  await allTopics.row(OFFSITE).expectVisible()
  await allTopics.filterKind('Channels')
  await allTopics.row(OFFSITE).expectAbsent()
  await allTopics.row(POSTGRES).expectVisible()

  // Place: the next test.

  // Sort: most messages puts the six-reply Postgres thread above the two-reply quiet one.
  await allTopics.sort('Most messages')
  const byMessages = await allTopics.titles()
  expect(byMessages.findIndex((title) => title.startsWith('Draft plan'))).toBeLessThan(byMessages.findIndex((title) => title.startsWith('Lag alerts')))
  await allTopics.sort('Oldest first')
  const oldest = await allTopics.titles()
  expect(oldest.findIndex((title) => title.startsWith('Lag alerts'))).toBeLessThan(oldest.findIndex((title) => title.startsWith('Draft plan')))
  await allTopics.sort('Most recent')

  // Text: a word from a reply finds its thread, not just titles.
  await allTopics.type('reaper')
  await allTopics.row(STAGING).expectVisible()
  await allTopics.row(POSTGRES).expectAbsent()
  await allTopics.expectCount('All', 1)
  await allTopics.type('nothing in slack says this')
  await allTopics.expectEmpty()
  await allTopics.clearFilters()
  await expect(allTopics.search).toHaveValue('')
  await allTopics.row(POSTGRES).expectVisible()
  await allTopics.row(QUIET).expectVisible()
}

async function pickTopicPlace({ juno }: Pick<Fixtures, 'juno'>): Promise<void> {
  const { allTopics } = juno
  await allTopics.open()

  // A channel by a word inside its name.
  await allTopics.filterPlace('review', 'design-review')
  await allTopics.row(DESIGN).expectVisible()
  await allTopics.row(POSTGRES).expectAbsent()
  await allTopics.filterPlace('', 'Anywhere')
  await allTopics.row(POSTGRES).expectVisible()

  await allTopics.filterKind('Channels')
  // With Channels on, the picker offers no DMs.
  await allTopics.placeButton.click()
  await allTopics.placeSearch.fill('maya')
  await expect(allTopics.placeOption('Maya')).toHaveCount(0)
  await allTopics.placeSearch.press('Escape')
  await expect(allTopics.placeSearch).toBeHidden()
  await expect(allTopics.placeButton).toBeFocused()

  // Every kind: a group DM by its people's names in any order, picked with the arrows and Enter.
  await allTopics.filterKind('All')
  await allTopics.placeButton.click()
  await allTopics.placeSearch.fill('leo maya')
  await expect(allTopics.placeOption('Maya')).toHaveCount(0)
  await allTopics.placeSearch.press('ArrowDown')
  await allTopics.placeSearch.press('ArrowUp')
  await allTopics.placeSearch.press('Enter')
  await expect(allTopics.placeSearch).toBeHidden()
  await expect(allTopics.placeButton).toHaveAccessibleName(/^Where: .*Leo/)
  await allTopics.row(POSTGRES).expectAbsent()
  await allTopics.row(OFFSITE).expectAbsent()
  expect(await allTopics.titles()).toHaveLength(1)

  // A DM by the person's name: the list narrows to that DM's topics.
  await allTopics.filterPlace('maya', 'Maya')
  await allTopics.row(OFFSITE).expectVisible()
  await allTopics.row(POSTGRES).expectAbsent()
  await allTopics.filterPlace('any', 'Anywhere')
  await allTopics.row(POSTGRES).expectVisible()
}

async function actOnTopicRows({ juno, slack }: Pick<Fixtures, 'juno' | 'slack'>): Promise<void> {
  const { allTopics, sidebar } = juno
  await allTopics.open()
  const postgres = allTopics.row(POSTGRES)

  // Resolve, then Undo from the toast.
  await postgres.chooseInMenu('resolve')
  await juno.expectToast(`Resolved · ${POSTGRES}`)
  await postgres.expectStatus('Resolved')
  await juno.undoFromToast()
  await postgres.expectStatus('Open')

  // Reopen a resolved topic from here, and ⌘Z.
  await postgres.chooseInMenu('resolve')
  await postgres.expectStatus('Resolved')
  await postgres.chooseInMenu('reopen')
  await juno.expectToast(`Reopened · ${POSTGRES}`)
  await postgres.expectStatus('Open')
  await juno.undo()
  await postgres.expectStatus('Resolved')
  await juno.undo()
  await postgres.expectStatus('Open')

  // Pin shows the pin; undo takes it off.
  await postgres.chooseInMenu('pin')
  await juno.expectToast(`Pinned · ${POSTGRES}`)
  await expect(postgres.root.getByTitle('Pinned')).toBeVisible()
  await juno.undo()
  await expect(postgres.root.getByTitle('Pinned')).toHaveCount(0)

  // Notify me: Never unfollows: Unfollowed here, gone from the sidebar. Always follows again; undo unfollows.
  await postgres.chooseInMenu('notify-never')
  await postgres.expectStatus('Unfollowed')
  await sidebar.row(POSTGRES).expectAbsent()
  await expect.poll(() => slack.fake.calls.some((call) => call.method === 'subscriptions.thread.remove'), { timeout: 10_000 }).toBe(true)
  await postgres.chooseInMenu('notify-always')
  await postgres.expectStatus('Open')
  await sidebar.row(POSTGRES).expectVisible()
  await juno.undo()
  await postgres.expectStatus('Unfollowed')
  await juno.undo()
  await postgres.expectStatus('Open')

  // A never-followed thread followed from here gets a sidebar row.
  await allTopics.row(FLAGS).chooseInMenu('notify-auto')
  await sidebar.row(FLAGS).expectVisible()

  // Rename edits the row in place; undo puts the old title back.
  await postgres.chooseInMenu('rename')
  await juno.rename('Postgres cutover')
  await allTopics.row('Postgres cutover').expectVisible()
  await juno.undo()
  await postgres.expectVisible()
}
