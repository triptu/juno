// The first sign-in on a large workspace, as a user meets it: the large
// seed, 300 ms per call (live calls took 257 to 446 ms) and the production
// request pacing. The sidebar shows rows within the quick-start budget
// (performance.md, "First sync"), then keeps filling in while the
// background lane reads history, with no reload.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { expect, launchApp, test, writeSlackApp } from './fixtures'

/** performance.md, "First sync": sign-in to usable sidebar rows on the large seed. */
const QUICK_START_BUDGET_MS = 5_000
const LATENCY_MS = 300

const large = test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: largeSeed(), latencyMillis: LATENCY_MS })
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

large('first sign-in shows threads, channels and DMs within the budget, then fills in without a reload', async ({ juno }) => {
  test.setTimeout(180_000)
  await juno.signIn({ skipSetUp: false })
  const signedIn = Date.now()
  await juno.skipSetUp()
  const { sidebar } = juno

  // Usable: rows the user can open, before history has been read.
  await expect(sidebar.rows.first()).toBeVisible({ timeout: Math.max(0, QUICK_START_BUDGET_MS - (Date.now() - signedIn)) })
  const quickStartMs = Date.now() - signedIn
  test.info().annotations.push({ type: 'quick start', description: `${quickStartMs} ms from sign-in to sidebar rows` })
  const first = await sidebar.titles()
  // A channel's Main is titled with its name; a thread with the first words of its root.
  expect(first.some((title) => title.startsWith('#'))).toBe(true)
  expect(first.some((title) => !title.startsWith('#') && title.split(' ').length >= 3)).toBe(true)
  // The tour opens over the app after a first sign-in (SPEC 4, "The tour"); it is not what this measures.
  await juno.tour.skip()
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
