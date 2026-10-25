// The first sign-in on a large workspace, as a user meets it: the large
// seed, 300 ms per call (live calls took 257 to 446 ms) and the production
// request pacing. The sidebar shows rows before history is read, then
// keeps filling in while the background lane reads history, with no
// reload. The 5 s quick-start budget (performance.md, "First sync") is
// asserted by `quick start` in perf.spec.ts on the Mac, on the large seed;
// here, inside a loaded plan, the time is recorded without a timing gate. The flows need busy channels and history still being read when
// they look, not the budget's size, so they use a fifth of the large seed.
import { largeSeed, startFakeSlack } from '@juno/fake-slack'
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

medium('the busiest channels show a preview seconds after sign-in, before their history is read', { tag: ['@heavy', '@heavy-sync'] }, async ({ juno, fake }) => {
  test.setTimeout(120_000)
  // History waits: any channel preview now comes from the preview search after the quick start.
  fake.holdNext({ method: 'conversations.history', times: 1_000, before: true, reason: 'history' })
  await juno.signIn({ skipSetUp: false })
  await juno.skipSetUp()
  const { sidebar } = juno
  await expect(sidebar.rows.first()).toBeVisible({ timeout: 60_000 })
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
  await expect.poll(channelPreviews, { timeout: 60_000 }).toBeGreaterThanOrEqual(5)
  test.info().annotations.push({ type: 'previews', description: `${Date.now() - quickStart} ms from rows to channel previews` })
  expect(fake.calls.filter((call) => call.method === 'conversations.history' && call.kind === 'api')).toHaveLength(0)
  expect(fake.heldCount({ method: 'conversations.history' })).toBe(1)
  fake.release({ method: 'conversations.history' })
})
