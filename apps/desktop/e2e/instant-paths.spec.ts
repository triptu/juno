// The paths a person takes most often paint from what Juno holds, with Slack holding every answer: opening Main
// and a thread from the sidebar, opening one again, a peek, going back to a tab, opening at a message from a link,
// ⌘K's results, and arrowing to a result in Search (performance.md 3.3). Slack is asked in the background; nothing
// here waits for it. `bun run affected` runs this spec whenever topic, sync, store, search or palette code changes
// (`GUARD_SPECS` in scripts/test-areas.mjs).
import { startFakeSlack, topic300Seed, type FakeSlack } from '@juno/fake-slack'
import { expect, test } from './fixtures'
import type { Juno } from './driver/juno'
import { searchPage } from './searchSteps'

test.use({ synced: true })
test.describe.configure({ timeout: 90_000 })

const POSTGRES = 'Draft plan is in the doc'
const ENG = '#eng'
const LONG = 'Long rollout log for paint checks'
const LONG_REPLIES = 600
/** What a step waits for. Painting from the store takes a frame or two; the limit only ends a failing run sooner. */
const PAINTED = { timeout: 5_000 }

/**
 * Every Slack API call waits before Slack runs it until `release`. `answered()` counts the calls answered since:
 * a step that paints with it at zero needed nothing from Slack.
 */
function holdSlack(fake: FakeSlack) {
  const answered = () => fake.calls.filter((call) => call.kind === 'api').length
  const before = answered()
  fake.gate(() => true)
  return { answered: () => answered() - before, release: () => fake.gate() }
}

/** The step painted with Slack holding everything, and no answer came first. */
async function paintsHeld(fake: FakeSlack, act: () => Promise<void>, painted: () => Promise<void>) {
  const slack = holdSlack(fake)
  try {
    await act()
    await painted()
    expect(slack.answered()).toBe(0)
  } finally {
    slack.release()
  }
}

/**
 * A followed thread of 600 replies (more than one open proves), read up to its tenth newest reply, opened once and
 * read to its end, then closed: what a long thread Juno has shown before looks like. The open proved the replies
 * from the read pointer on, so the store cannot prove the stretch above the window's first row. Its last reply
 * arrives live, so Juno looks the root up with its counts.
 */
async function longThread(juno: Juno, fake: FakeSlack) {
  // After every message the sync stored, so the root is the newest in Main.
  const start = fake.advanceClock({ millis: 5 * 60_000 }) - 60_000
  const root = fake.workspace.post({ channel: 'C0ENG', user: 'U0LEO', text: LONG, at: start, silent: true })
  const replies = Array.from({ length: LONG_REPLIES - 1 }, (_, i) =>
    fake.workspace.post({ channel: 'C0ENG', user: 'U0MAYA', text: `rollout step ${i + 1}`, threadTs: root.ts, at: start + (i + 1) * 50, silent: true }))
  // The last one live: Juno looks the root up, with its counts, as it does for a reply to a thread it lacks.
  replies.push(fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `rollout step ${LONG_REPLIES}`, threadTs: root.ts }))
  await juno.sidebar.row(ENG).open()
  await juno.topic.expectMessage(LONG)
  // Off the sidebar, which holds its order under the pointer (SPEC 5), so the thread's new row can come in.
  await juno.win.mouse.move(700, 400)
  fake.markThreadRead({ channel: 'C0ENG', threadTs: root.ts, ts: replies[LONG_REPLIES - 11]!.ts })
  fake.followThread({ channel: 'C0ENG', threadTs: root.ts })
  const row = juno.sidebar.row(LONG)
  await row.expectVisible()
  await row.open()
  await juno.topic.expectMessage(`rollout step ${LONG_REPLIES}`)
  await row.expectRead()
  await juno.sidebar.row(ENG).open()
  return { root, replies, row }
}

test('Main opens from the sidebar from what Juno holds', async ({ juno, fake }) => {
  await paintsHeld(fake, () => juno.sidebar.row(ENG).open(), () => expect(juno.topic.message('preview environments never shut down')).toBeVisible(PAINTED))
})

test('a thread opens from the sidebar from what Juno holds', async ({ juno, fake }) => {
  await paintsHeld(fake, () => juno.sidebar.row(POSTGRES).open(), () => expect(juno.topic.message('Booked 2–4pm')).toBeVisible(PAINTED))
})

test('a thread opens again from what Juno holds', async ({ juno, fake }) => {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectMessage('Booked 2–4pm')
  await juno.tabs.close(POSTGRES)
  await paintsHeld(fake, () => juno.sidebar.row(POSTGRES).open(), () => expect(juno.topic.message('Booked 2–4pm')).toBeVisible(PAINTED))
})

test('a long thread opens again from what Juno holds', async ({ juno, fake }) => {
  await longThread(juno, fake)
  await paintsHeld(fake, () => juno.sidebar.row(LONG).open(), () => expect(juno.topic.message(`rollout step ${LONG_REPLIES}`)).toBeVisible(PAINTED))
})

test('a peek at a long thread shows what Juno holds', async ({ juno, fake }) => {
  const { row } = await longThread(juno, fake)
  await paintsHeld(fake, () => row.peek(), () => juno.peek.expectMessage(`rollout step ${LONG_REPLIES}`))
  await juno.peek.release()
})

test('going back to a tab shows it as it was', async ({ juno, fake }) => {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectMessage('Booked 2–4pm')
  await juno.sidebar.row(ENG).openInNewTab()
  await juno.topic.expectMessage('preview environments never shut down')
  await paintsHeld(fake, () => juno.tabs.select(POSTGRES), () => expect(juno.topic.message('Booked 2–4pm')).toBeVisible(PAINTED))
})

test('a link to a reply Juno holds opens the thread at it', async ({ juno, fake }) => {
  const { root, replies } = await longThread(juno, fake)
  const target = replies[299]!
  const link = `${fake.url}/archives/C0ENG/p${target.ts.replace('.', '')}?thread_ts=${root.ts}&cid=C0ENG`
  fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: `Look at <${link}|the middle step>` })
  const anchor = juno.topic.message('Look at the middle step').getByRole('link', { name: 'the middle step' })
  // The first click fetches the reply; after that Juno holds it.
  await anchor.click()
  await juno.topic.expectMessage('rollout step 300')
  await juno.tabs.close(LONG)
  await juno.topic.expectMessage('Look at the middle step')
  await paintsHeld(fake, () => anchor.click(), () => expect(juno.topic.message('rollout step 300')).toBeVisible(PAINTED))
})

test('⌘K shows results from what Juno holds', async ({ juno, fake }) => {
  await paintsHeld(fake, async () => {
    await juno.palette.open()
    await juno.palette.type('draft plan')
  }, () => expect(juno.palette.root.getByRole('option', { name: new RegExp(POSTGRES) }).first()).toBeVisible(PAINTED))
})

test('arrowing to a result in Search shows its topic from what Juno holds', async ({ juno, fake }) => {
  const page = searchPage(juno.win)
  await juno.surface.appMenu('search-messages')
  await page.field.pressSequentially('booked')
  await expect(page.row('Booked 2–4pm')).toBeVisible()
  await paintsHeld(fake, async () => {
    await page.field.press('ArrowDown')
    await juno.win.keyboard.press('Space')
  }, () => expect(page.reader.getByText('Booked 2–4pm')).toBeVisible(PAINTED))
})

test.describe('a thread known only from Slack’s thread list', () => {
  test.use({ synced: false })
  const longTest = test.extend({
    // oxlint-disable-next-line no-empty-pattern
    fake: async ({}, use) => {
      const fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
      await use(fake)
      await fake.close()
    },
  })

  // Its replies came from `getView` alone, which proves none of them continuous: the tab shows what Juno holds
  // while its one fetch is out.
  longTest('opens from the sidebar with what Juno holds', async ({ juno, fake }) => {
    await juno.signIn()
    await juno.waitForSync()
    await paintsHeld(fake, () => juno.sidebar.row('Review the rollout checklist 1').open(), () => expect(juno.topic.message('Review the rollout checklist 300')).toBeVisible(PAINTED))
  })
})
