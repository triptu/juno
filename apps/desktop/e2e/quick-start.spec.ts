// The first sign-in on a large workspace, as a user meets it: the large
// seed, 300 ms per call (live calls took 257 to 446 ms) and the production
// request pacing. The sidebar shows rows before history is read, then
// keeps filling in while the background lane reads history, with no
// reload. The 5 s quick-start budget (performance.md, "First sync") is
// asserted by `quick start` in perf.spec.ts on the Mac, on the large seed;
// here, inside a loaded plan, the time is recorded and only a ceiling is
// checked. The flows need busy channels and history still being read when
// they look, not the budget's size, so they use a fifth of the large seed.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { expect, launchApp, test, writeSlackApp } from './fixtures'

/**
 * Sign-in to usable sidebar rows. About 2.7 s on a quiet remote machine; in
 * a plan at 96% busy it went over 5 s. Rows that take this long mean the
 * quick start is broken, not slow.
 */
const QUICK_START_CEILING_MS = 30_000
/** The preview search runs right after the quick start; its second page waits for search's pacing (10 a minute). */
const PREVIEW_BUDGET_MS = 10_000
const LATENCY_MS = 300

/** A first sign-in against a seed of this size, with live latency and pacing. */
const signInOn = (seed: Parameters<typeof largeSeed>[0]) => test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: largeSeed(seed), latencyMillis: LATENCY_MS })
    await use(fake)
    await fake.close()
  },
  slackApp: async ({ fake }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
    await use(await writeSlackApp(fake, dir))
    await rm(dir, { recursive: true, force: true })
  },
  running: async ({ fake, slackApp, userData }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, paced: true })
    await use(running)
    await running.close()
  },
})

/** A fifth of the large seed (as in perf.spec.ts): plenty of busy channels, and quicker to make and read. */
const medium = signInOn({ topics: 1_200, messages: 12_000, users: 400, channels: { public: 60, private: 20, dms: 30, mpims: 10 } })

medium('first sign-in shows threads, channels and DMs before history is read, then fills in without a reload', async ({ juno }) => {
  test.setTimeout(180_000)
  await juno.signIn({ skipSetUp: false })
  const signedIn = Date.now()
  await juno.skipSetUp()
  const { sidebar } = juno

  // Usable: rows the user can open, before history has been read.
  await expect(sidebar.rows.first()).toBeVisible({ timeout: Math.max(0, QUICK_START_CEILING_MS - (Date.now() - signedIn)) })
  const quickStartMs = Date.now() - signedIn
  test.info().annotations.push({ type: 'quick start', description: `${quickStartMs} ms from sign-in to sidebar rows` })
  const first = await sidebar.titles()
  // A channel's Main is titled with its name; a thread with the first words of its root.
  expect(first.some((title) => title.startsWith('#'))).toBe(true)
  expect(first.some((title) => !title.startsWith('#') && title.split(' ').length >= 3)).toBe(true)
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

medium('the busiest channels show a preview seconds after sign-in, before their history is read', async ({ juno, fake }) => {
  test.setTimeout(120_000)
  // History waits: any channel preview now comes from the preview search after the quick start.
  fake.holdNext({ method: 'conversations.history', times: 1_000, before: true, reason: 'history' })
  await juno.signIn({ skipSetUp: false })
  await juno.skipSetUp()
  const { sidebar } = juno
  await expect(sidebar.rows.first()).toBeVisible({ timeout: QUICK_START_CEILING_MS })
  const quickStart = Date.now()

  // A channel's Main row with a "Sender: text" preview.
  const channelPreviews = () =>
    sidebar.rows.evaluateAll((rows) =>
      rows.filter((row) => {
        const titleId = row.getAttribute('aria-labelledby')
        const title = (titleId === null ? null : document.getElementById(titleId)?.textContent) ?? ''
        return title.startsWith('#') && (row.textContent ?? '').slice(title.length).includes(': ')
      }).length,
    )
  await expect.poll(channelPreviews, { timeout: PREVIEW_BUDGET_MS }).toBeGreaterThanOrEqual(5)
  test.info().annotations.push({ type: 'previews', description: `${Date.now() - quickStart} ms from rows to channel previews` })
  expect(fake.calls.filter((call) => call.method === 'conversations.history' && call.kind === 'api')).toHaveLength(0)
  expect(fake.heldCount({ method: 'conversations.history' })).toBe(1)
  fake.release({ method: 'conversations.history' })
})
