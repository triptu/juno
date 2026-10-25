// First-sync timing ceilings, weekly in the laptop perf run (docs/performance.md 7.3); correctness is in
// packages/engine/test/flows/first-sync.flow.test.ts and quick-start.flow.test.ts. The quick start's own budget, sign-in to rows on the
// large seed, is `quick start` in perf.spec.ts.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
import { expect, launchApp, test, writeSlackApp } from './fixtures'

test.skip(process.env.JUNO_PERF !== '1', 'set JUNO_PERF=1 to measure')

/**
 * Sign-in to usable sidebar rows. About 2.7 s on a quiet remote machine; in
 * a plan at 96% busy it went over 5 s. Rows that take this long mean the
 * quick start is broken, not slow.
 */
const QUICK_START_CEILING_MS = 30_000
/** The preview search runs right after the quick start; its second page waits for search's pacing (10 a minute). */
const PREVIEW_BUDGET_MS = 10_000
const LATENCY_MS = 300

/** A first sign-in against a seed of this size, with live latency and pacing unless `options` say otherwise. */
const signInOn = (seed: Parameters<typeof largeSeed>[0], options: { readonly latency?: number; readonly paced?: boolean } = {}) => test.extend({
  // oxlint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await startFakeSlack({ seed: largeSeed(seed), latencyMillis: options.latency ?? LATENCY_MS })
    await use(fake)
    await fake.close()
  },
  slackApp: async ({ fake }, use) => {
    const dir = await mkdtemp(join(tmpdir(), 'juno-slack-app-'))
    await use(await writeSlackApp(fake, dir))
    await rm(dir, { recursive: true, force: true })
  },
  running: async ({ fake, slackApp, userData }, use) => {
    const running = await launchApp(userData, { fakeSlackUrl: fake.url, slackAppDir: slackApp.dir, keychainPassword: slackApp.keychainPassword, paced: options.paced ?? true })
    await use(running)
    await running.close()
  },
})

/** A fifth of the large seed (as in perf.spec.ts): plenty of busy channels, and quicker to make and read. */
const MEDIUM = { topics: 1_200, messages: 12_000, users: 400, channels: { public: 60, private: 20, dms: 30, mpims: 10 } }
const medium = signInOn(MEDIUM)

medium('the busiest channels show a preview seconds after sign-in, before their history is read', { tag: ['@heavy', '@heavy-sync', '@perf-weekly'] }, async ({ juno, fake }) => {
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

