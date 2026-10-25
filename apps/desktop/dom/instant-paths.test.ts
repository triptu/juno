// The paths a person takes most often paint from what Juno holds, with Slack holding every answer: opening Main
// and a thread from the sidebar, opening one again, going back to a tab, ⌘K's results, arrowing to a result in
// Search, a peek, and opening at a message from a link (performance.md 3.3). Every Slack API call waits at the
// fake's gate while the step paints; nothing here waits for Slack. `bun run affected` runs this file, as every DOM file, whenever
// the renderer, the host or what they import changes.
import { topic300Seed, type FakeSlack } from '@juno/fake-slack'
import type { Juno } from './driver/juno'
import { searchPage } from './driver/palette'
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const ENG = '#eng'
const LONG = 'Long rollout log for paint checks'
const LONG_REPLIES = 600

/** The step paints while every Slack API call waits before Slack runs it, then they all go on. */
async function paintsHeld(fake: FakeSlack, act: () => Promise<void>, painted: () => Promise<void>) {
  fake.gate(() => true)
  try {
    await act()
    await painted()
  } finally {
    fake.gate()
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
  replies.push(fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `rollout step ${LONG_REPLIES}`, threadTs: root.ts }))
  await juno.sidebar.row(ENG).open()
  await juno.topic.expectMessage(LONG)
  // Off the sidebar, which holds its order under the pointer (SPEC 5), so the thread's new row can come in.
  juno.win.unhover()
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

domTest('Main, a thread, a thread again, a tab gone back to, ⌘K and Search paint from what Juno holds', async ({ juno, fake, step }) => {
  await step('Main opens from the sidebar', () => paintsHeld(fake, () => juno.sidebar.row(ENG).open(), () => expect(juno.topic.message('preview environments never shut down')).toBeVisible()))
  await step('a thread opens from the sidebar', () => paintsHeld(fake, () => juno.sidebar.row(POSTGRES).open(), () => expect(juno.topic.message('Booked 2–4pm')).toBeVisible()))
  await step('a thread opens again', async () => {
    await juno.sidebar.row(ENG).open()
    await juno.topic.expectTitle('Main')
    await paintsHeld(fake, () => juno.sidebar.row(POSTGRES).open(), () => expect(juno.topic.message('Booked 2–4pm')).toBeVisible())
  })
  await step('going back to a tab shows it as it was', async () => {
    await juno.sidebar.row(ENG).openInNewTab()
    await juno.topic.expectMessage('preview environments never shut down')
    await paintsHeld(fake, () => juno.tabs.select(POSTGRES), () => expect(juno.topic.message('Booked 2–4pm')).toBeVisible())
  })
  await step('⌘K shows results', async () => {
    await paintsHeld(fake, async () => {
      await juno.palette.open()
      await juno.palette.type('draft plan')
    }, () => expect(juno.palette.root.getByRole('option', { name: new RegExp(POSTGRES) }).first()).toBeVisible())
    await juno.palette.press('Escape')
    await juno.palette.expectClosed()
  })
  await step('arrowing to a result in Search shows its topic', async () => {
    const page = searchPage(juno.win)
    await juno.surface.appMenu('search-messages')
    await page.field.pressSequentially('booked')
    await expect(page.row('Booked 2–4pm')).toBeVisible()
    await paintsHeld(fake, async () => {
      await page.field.press('ArrowDown')
      await juno.win.keyboard.press('Space')
    }, () => expect(page.reader.getByText('Booked 2–4pm')).toBeVisible())
  })
})

domTest('a long thread opens again, peeks and opens at a linked reply from what Juno holds', async ({ juno, fake, step }) => {
  const { root, replies, row } = await longThread(juno, fake)
  await step('it opens again', async () => {
    await paintsHeld(fake, () => row.open(), () => expect(juno.topic.message(`rollout step ${LONG_REPLIES}`)).toBeVisible())
    await juno.sidebar.row(ENG).open()
    await juno.topic.expectTitle('Main')
  })
  await step('a peek shows it', async () => {
    await paintsHeld(fake, () => row.peek(), () => juno.peek.expectMessage(`rollout step ${LONG_REPLIES}`))
    await juno.peek.release()
    await juno.peek.expectClosed()
  })
  await step('a link to a reply opens the thread at it', async () => {
    const target = replies[299]!
    const link = `${fake.url}/archives/C0ENG/p${target.ts.replace('.', '')}?thread_ts=${root.ts}&cid=C0ENG`
    fake.injectMessage({ channel: 'C0ENG', user: 'U0SAM', text: `Look at <${link}|the middle step>` })
    const anchor = juno.topic.message('Look at the middle step').getByRole('link', { name: 'the middle step' })
    // The first click fetches the reply; after that Juno holds it.
    await anchor.click()
    await juno.topic.expectMessage('rollout step 300')
    await juno.tabs.close(LONG)
    await juno.topic.expectMessage('Look at the middle step')
    await paintsHeld(fake, () => anchor.click(), () => expect(juno.topic.message('rollout step 300')).toBeVisible())
  })
})

// Its replies came from `getView` alone, which proves none of them continuous: the tab shows what Juno holds
// while its one fetch is out.
domTest('a thread known only from Slack’s thread list opens from the sidebar with what Juno holds', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  await paintsHeld(fake, () => juno.sidebar.row('Review the rollout checklist 1').open(), () => expect(juno.topic.message('Review the rollout checklist 300')).toBeVisible())
}, { synced: false, fake: { seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) } })
