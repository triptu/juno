// The All topics page (SPEC 11, inventory 10) against the fake Slack: it
// lists what the sidebar leaves out (quiet, resolved, unfollowed and
// never-followed topics), a row opens its topic in the tab, the filters reach
// the list, and the place picker finds conversations by word.
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

// What each filter keeps, the chip counts and a row's status after an action are the engine's
// all-topics flow test; the row menu is actions.spec.ts. This checks the controls reach the list.
test('the filters reach the list, and the place picker searches conversations by word', async ({ juno }) => {
  await test.step('a status chip, the text filter and Clear filters each change the list', () => useFilters(juno))
  await test.step('the place picker searches conversations by word, and a pick narrows the list', () => pickTopicPlace({ juno }))
})

async function useFilters(juno: Fixtures['juno']): Promise<void> {
  const { allTopics } = juno
  await allTopics.open()
  await allTopics.filterStatus('Quiet')
  await allTopics.row(QUIET).expectVisible()
  await allTopics.row(POSTGRES).expectAbsent()
  await allTopics.filterStatus('All')
  await allTopics.type('reaper')
  await allTopics.row(STAGING).expectVisible()
  await allTopics.row(POSTGRES).expectAbsent()
  await allTopics.expectCount('All', 1)
  await allTopics.clearFilters()
  await expect(allTopics.search).toHaveValue('')
  await allTopics.row(POSTGRES).expectVisible()
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
