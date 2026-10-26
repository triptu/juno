// Counted budgets for the renderer (docs/performance.md, "Counted budgets"): React commits and
// component renders, and the port's requests, live messages and bytes, for each main path: startup to
// the first rows, opening a topic and opening it again, switching tabs, typing in the composer,
// sending, a live message arriving, and the sidebar of 300 conversations. A budget fails when the work
// grows: the whole sidebar rendering again for one row, a context that re-renders every message on a
// keystroke, a payload that doubled, a subscription opened twice. The engine's frames reach the page one
// at a time (`counted`), so the counts do not depend on timing. Budgets are today's counts plus a little
// headroom; `JUNO_WORK_COUNTS=1` prints the counts.
import { largeSeed, type FakeSlack } from '@juno/fake-slack'
import { expectWork, type Counts } from '@juno/testing/work-budget'
import type { DomApp } from './app'
import type { Juno } from './driver/juno'
import { expect } from './expect'
import { domTest } from './test'
import { pageWork, settledPage, workSince, type PageWork } from './work'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'

/** The counts a budget reads. */
const counts = (work: PageWork): Counts => ({ commits: work.commits, renders: work.renders, requests: work.requests, messages: work.messages, bytesIn: work.bytesIn, bytesOut: work.bytesOut })

/** What the counts were made of: the components that rendered most and the routes that carried them. */
const detail = (work: PageWork) => [
  'renders: ' + Object.entries(work.byComponent).toSorted((a, b) => b[1] - a[1]).slice(0, 15).map(([name, n]) => `${name} ${n}`).join(', '),
  'routes: ' + Object.entries(work.byRoute).toSorted((a, b) => b[1].bytesIn - a[1].bytesIn).slice(0, 12).map(([tag, t]) => `${tag} ${t.requests}/${t.messages}/${t.bytesIn}B/${t.bytesOut}B`).join(', '),
].join('\n')

/**
 * The relaunched engine has its socket and has made no Slack call for a second: its catch-up is done, so
 * the page's startup is counted against an engine at rest, whose re-runs do not fall by timing.
 */
async function engineAtRest(fake: FakeSlack): Promise<void> {
  let calls = -1
  let since = Date.now()
  while (Date.now() - since < 1_000) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (fake.callCount() !== calls || fake.socketCount() !== 1) {
      calls = fake.callCount()
      since = Date.now()
    }
  }
}

/**
 * Slack shows the user active on the account button. It turns active once the shell's activity poll, every
 * 10 s, has made the engine tickle Slack, at a time that depends on the machine's load, so startup counts wait
 * for it and no later step counts it.
 */
const presenceShown = (juno: Juno) => expect(juno.sidebar.accountButton.locator('[data-presence="active"]')).toHaveCount(1, { timeout: 30_000 })

/** `action`, then everything it set off, counted on the page. */
async function measured(app: () => DomApp, action: () => Promise<void>): Promise<PageWork> {
  await settledPage(app().window)
  const before = pageWork(app().window)
  await action()
  await settledPage(app().window)
  return workSince(app().window, before)
}

domTest('startup, a topic opened and opened again, tabs, typing, a send and a live message stay within their counted budgets', async ({ juno, app, fake, slack, relaunch, step }) => {
  await step('startup: a relaunch to the sidebar rows from the cache, at rest', async () => {
    juno = await relaunch({ beforeOpen: () => engineAtRest(fake) })
    await juno.sidebar.expectRows()
    await juno.expectEngineLive()
    await presenceShown(juno)
    await settledPage(app.window)
    const work = pageWork(app.window)
    expectWork('startup', counts(work), { commits: 38, renders: 526, requests: 47, messages: 47, bytesIn: 42009 }, detail(work))
  })

  await step('opening a topic from the sidebar for the first time', async () => {
    const work = await measured(() => app, async () => {
      await juno.sidebar.row(POSTGRES).open()
      await juno.topic.expectTitle(POSTGRES)
          })
    expectWork('topic open, cold', counts(work), { commits: 12, renders: 446, requests: 14, messages: 15, bytesIn: 9706, bytesOut: 1389 }, detail(work))
  })

  await step('a second topic in a new tab, then switching between the two tabs', async () => {
    await measured(() => app, async () => {
      await juno.sidebar.row(RINA).openInNewTab()
      await juno.topic.expectTitle(RINA)
    })
    const work = await measured(() => app, () => juno.tabs.select(POSTGRES))
    expectWork('tab switch', counts(work), { commits: 5, renders: 64, requests: 5, messages: 6, bytesIn: 542, bytesOut: 558 }, detail(work))
  })

  await step('opening the first topic again after closing its tab', async () => {
    await measured(() => app, () => juno.tabs.close(POSTGRES))
    const work = await measured(() => app, async () => {
      await juno.sidebar.row(POSTGRES).open()
      await juno.topic.expectTitle(POSTGRES)
    })
    expectWork('topic open, again', counts(work), { commits: 7, renders: 348, requests: 6, messages: 7, bytesIn: 517, bytesOut: 538 }, detail(work))
  })

  await step('typing twenty-one characters in the composer, a commit or two a key, and one draft save after', async () => {
    await juno.topic.composer.focus()
    await settledPage(app.window)
    const before = pageWork(app.window)
    await juno.win.keyboard.type('counting each key now')
    await expect(juno.topic.composer).toHaveValue('counting each key now')
    // The keys alone: the draft is saved 400 ms after the last one, and its echo is the engine's, by timing.
    const keys = workSince(app.window, before)
    expectWork('typing', counts(keys), { commits: 47, renders: 116, requests: 0, messages: 0, bytesIn: 0, bytesOut: 0 }, detail(keys))
    await settledPage(app.window)
    const saved = workSince(app.window, before)
    expectWork('typing, the draft save', { requests: saved.requests, bytesOut: saved.bytesOut }, { requests: 1, bytesOut: 137 }, detail(saved))
  })

  await step('sending it', async () => {
    const work = await measured(() => app, async () => {
      await juno.topic.composer.press('Enter')
      await juno.topic.expectSent('counting each key now')
    })
    expectWork('send', counts(work), { commits: 10, renders: 286, requests: 6, messages: 14, bytesIn: 6364, bytesOut: 567 }, detail(work))
  })

  await step('a reply arriving in the open topic', async () => {
    const work = await measured(() => app, async () => {
      slack.as('Leo').replyIn(POSTGRES, 'Counting a live reply')
      await juno.topic.expectMessage('Counting a live reply')
    })
    expectWork('live reply', counts(work), { commits: 8, renders: 275, requests: 3, messages: 15, bytesIn: 8984, bytesOut: 102 }, detail(work))
  })
}, { counted: true })

domTest('the sidebar of 300 conversations: its first rows from the cache, and one live message renders one row', async ({ juno, app, fake, relaunch, step }) => {
  await juno.signIn()
  await juno.sidebar.expectRows()
  // The first sync of 300 conversations is setup, not counted; beside a full lane's other workers it takes longer than the usual wait.
  await juno.expectEngineLive(100_000)

  await step('startup: a relaunch to the first rows from the cache, at rest', async () => {
    juno = await relaunch({ beforeOpen: () => engineAtRest(fake) })
    await juno.sidebar.expectRows()
    await juno.expectEngineLive()
    await presenceShown(juno)
    await settledPage(app.window)
    const work = pageWork(app.window)
    expectWork('large sidebar startup', counts(work), { commits: 40, renders: 3112, requests: 48, messages: 49, bytesIn: 398313 }, detail(work))
  })

  await step('a message in one conversation', async () => {
    const channel = [...fake.workspace.conversations].find(([, conversation]) => conversation.kind === 'public')![0]
    const work = await measured(() => app, async () => {
      fake.injectMessage({ channel, user: 'U000001L', text: 'Counting one live message' })
      await expect(juno.sidebar.root).toContainText('Counting one live message')
    })
    expectWork('large sidebar live message', counts(work), { commits: 3, renders: 19, requests: 0, messages: 6, bytesIn: 8154, bytesOut: 0 }, detail(work))
  })
}, { counted: true, synced: false, fake: { seed: largeSeed({ users: 60, topics: 150, messages: 1_500, days: 2 }) }, timeout: 180_000 })
