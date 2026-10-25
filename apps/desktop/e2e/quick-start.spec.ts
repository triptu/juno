// The first sign-in on a large workspace, as a user meets it: the large
// seed, 300 ms per call (live calls took 257 to 446 ms) and the production
// request pacing. The sidebar shows rows before history is read, then
// keeps filling in while the background lane reads history, with no
// reload. The 5 s quick-start budget (performance.md, "First sync") is
// asserted by `quick start` in perf.spec.ts on the Mac, on the large seed;
// here, inside a loaded plan, the time is recorded without a timing gate. The flows need busy channels and history still being read when
// they look, not the budget's size, so they use a fifth of the large seed.
import { largeSeed, SELF_ID, startFakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'

const LATENCY_MS = 300

/** A first sign-in against a seed of this size, with live latency and pacing unless `options` say otherwise. */
const signInOn = (seed: Parameters<typeof largeSeed>[0], options: { readonly latency?: number; readonly paced?: boolean } = {}) => test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: largeSeed(seed), latencyMillis: options.latency ?? LATENCY_MS })
    await use(fake)
    await fake.close()
  },
  paced: options.paced ?? true,
})

/** A fifth of the large seed (as in perf.spec.ts): plenty of busy channels, and quicker to make and read. */
const MEDIUM = { topics: 1_200, messages: 12_000, users: 400, channels: { public: 60, private: 20, dms: 30, mpims: 10 } }
const medium = signInOn(MEDIUM)
/** The same seed with no pacing and short calls: the history order matters here, not the time it takes. */
const mediumQuick = signInOn(MEDIUM, { latency: 50, paced: false })

medium('first sign-in shows threads and DMs before history is read, channels once sorted, then fills in without a reload', { tag: ['@heavy', '@heavy-sync'] }, async ({ juno }) => {
  test.setTimeout(180_000)
  await juno.signIn({ skipSetUp: false })
  const signedIn = Date.now()
  await juno.skipSetUp()
  const { sidebar } = juno

  // Usable: rows the user can open, before history has been read.
  await expect(sidebar.rows.first()).toBeVisible({ timeout: 60_000 })
  const quickStartMs = Date.now() - signedIn
  test.info().annotations.push({ type: 'quick start', description: `${quickStartMs} ms from sign-in to sidebar rows` })
  // A thread is titled with the first words of its root.
  expect((await sidebar.titles()).some((title) => !title.startsWith('#') && title.split(' ').length >= 3)).toBe(true)
  // A channel's Main is titled with its name. A channel waits out of All until Automated's rules have read its
  // history, five seconds at most, so a bot channel never shows there first (SPEC 5, "The topic list").
  await expect.poll(async () => (await sidebar.titles()).some((title) => title.startsWith('#')), { timeout: 10_000 }).toBe(true)
  await sidebar.filter('DMs')
  await expect(sidebar.rows.first()).toBeVisible()
  await sidebar.filter('All')

  // Conversations whose history has not been read yet show from `client.counts`: their name and time, no preview.
  const withPreview = () => sidebar.rows.filter({ hasText: ': ' }).count()
  await expect.poll(() => sidebar.rows.filter({ hasNotText: ': ' }).count()).toBeGreaterThan(0)
  const previewsAtStart = await withPreview()

  // The sync is still reading, and the rows follow it with no reload: previews arrive as history lands.
  await expect.poll(withPreview, { timeout: 120_000 }).toBeGreaterThan(previewsAtStart)
})

mediumQuick('Home is ready once DMs, mentions and unread threads have history, before the last history page', { tag: ['@heavy', '@heavy-sync'] }, async ({ juno, fake }) => {
  test.setTimeout(120_000)
  // What Home is made of (SPEC 12, owner 10-18): DMs and group DMs, conversations with an unread mention, and those
  // with unread replies in a followed thread. History reads them first, one conversation at a time.
  const ws = fake.workspace
  const threads = ws.threadCounts()
  // The default topic window is three days.
  const windowStart = (Date.now() - 3 * 86_400_000) / 1000
  const forHome = new Set([...ws.conversations.values()].filter((c) => {
    if (!c.members.has(SELF_ID) || c.archived) return false
    const entry = ws.countEntry(c)
    if (entry.latest === undefined || Number(entry.latest) < windowStart) return false
    return c.kind === 'im' || c.kind === 'mpim' || (entry.has_unreads && entry.mention_count > 0)
      || (threads.mention_count_by_channel?.[c.id] ?? 0) > 0 || (threads.unread_count_by_channel?.[c.id] ?? 0) > 0
  }).map((c) => c.id))
  // The history of anything else waits, so the sync stops at the first conversation Home does not need.
  fake.gate((method, args) => method === 'conversations.history' && args['_x_reason'] === 'history' && !forHome.has(args['channel'] ?? ''))
  await juno.signIn()
  await juno.home.navItem.click()

  // Home is ready while the sidebar still syncs.
  await expect(juno.home.greeting).toBeVisible({ timeout: 60_000 })
  await expect(juno.home.root.locator('h2 + p')).toHaveCount(0)
  await expect(juno.home.root.getByText('All caught up.')).toHaveCount(0)
  await expect(juno.sidebar.syncStatus).toHaveText('Syncing with Slack')
  expect(fake.gated().filter((call) => call.method === 'conversations.history')).toHaveLength(1)
  const read = new Set(fake.calls.filter((call) => call.method === 'conversations.history' && call.args['_x_reason'] === 'history').map((call) => call.args['channel']))
  expect([...forHome].filter((id) => !read.has(id))).toEqual([])

  // Home stays usable while the rest of history lands and its live rows update.
  fake.gate()
  await juno.waitForSync()
  await expect(juno.home.root).toBeVisible()
  expect((await juno.home.kinds()).length).toBeLessThanOrEqual(3)
})
