// Reading a topic in the browser: a long thread opens with its divider 80px below the band and
// older pages load without a shift; the header's controls answer hover and press, its menus
// open under their islands, Resolve takes Follow's place without moving the title, and the
// switcher fits the minimum window. What the topic shows and sends (prefetch, the divider and
// read mark, Notify me, Follow, thread links, the switcher) is in the DOM lane (`dom/topic.test.ts`).
import { measureLayoutShift } from '@juno/testing/layout-shift'
import { startFakeSlack, topic300Seed } from '@juno/fake-slack'
import { expect, syncedTest, test, type Fixtures } from './fixtures'

test.describe.configure({ timeout: 90_000 })

const POSTGRES = 'Draft plan is in the doc'
const CHECKOUT = 'checkout.spec failed again on main.'
const ENG_MAIN = '#eng'

syncedTest('the header answers hover and press, its menus open under their islands, Resolve takes Follow’s place without moving the title, and the switcher fits the minimum window', async ({ juno, win }) => {
  await test.step('every control in the header answers hover and press', () => headerFeedback({ juno, win }))

  await test.step('⋯ opens the topic menu at its left edge under the right island; the title’s menu opens at the title’s left edge', async () => {
    await juno.sidebar.row(POSTGRES).open()
    await juno.topic.expectTitle(POSTGRES)
    const more = await juno.topic.chooseInMenu('copy-link')
    const island = (await juno.topic.header.locator('[data-island="right"]').boundingBox())!
    const button = (await juno.topic.moreButton.boundingBox())!
    expect(more.at).not.toBeNull()
    expect(Math.round(more.at!.x)).toBe(Math.round(button.x))
    expect(more.at!.y).toBeGreaterThan(island.y + island.height)
    const titled = await juno.topic.chooseInTitleMenu('copy-link')
    const title = (await juno.topic.titleButton.boundingBox())!
    expect(Math.round(titled.at!.x)).toBe(Math.round(title.x))
  })

  await test.step('Resolve takes Follow’s place at its width, and the title does not move', async () => {
    await juno.sidebar.row(ENG_MAIN).open()
    await juno.topic.threadLinkUnder(CHECKOUT).open()
    await juno.topic.expectTitle(CHECKOUT)
    const follow = (await juno.topic.followButton.boundingBox())!
    const title = (await juno.topic.titleButton.boundingBox())!
    await juno.topic.follow()
    const resolve = juno.topic.header.getByRole('button', { name: 'Resolve', exact: true })
    await expect(resolve).toBeVisible()
    const swapped = (await resolve.boundingBox())!
    expect(Math.round(swapped.x)).toBe(Math.round(follow.x))
    expect(Math.round(swapped.width)).toBe(Math.round(follow.width))
    expect(await juno.topic.titleButton.boundingBox()).toEqual(title)
  })

  await test.step('at the minimum window size the topic switcher stays inside the workspace', async () => {
    await juno.setWindowSize(720, 480)
    await juno.sidebar.row(ENG_MAIN).open()
    await juno.topic.expectTitle('Main')
    const switcher = await juno.topic.openSwitcher()
    const pane = (await win.getByRole('region', { name: 'Workspace' }).boundingBox())!
    const list = (await switcher.root.boundingBox())!
    expect(list.x).toBeGreaterThanOrEqual(pane.x)
    expect(list.x + list.width).toBeLessThanOrEqual(pane.x + pane.width)
  })
})

test.describe('a long thread', () => {
  const longTest = test.extend({
    // oxlint-disable-next-line no-empty-pattern
    fake: async ({}, use) => {
      const fake = await startFakeSlack({ seed: (workspace, avatars) => void topic300Seed()(workspace, avatars) })
      await use(fake)
      await fake.close()
    },
  })
  const THREAD = 'Review the rollout checklist 1'

  longTest('opens with the first new reply 80px below the header band, and older pages load without moving what is on screen', async ({ juno, slack }) => {
    await juno.signIn()
    await juno.waitForSync()
    const row = juno.sidebar.row(THREAD)
    // The first open reads the whole thread; close it and let 40 replies arrive.
    await row.open()
    await juno.topic.expectAtBottom()
    await row.expectRead()
    await juno.tabs.close(THREAD)
    for (let i = 0; i < 40; i++) slack.as('Leo').replyIn(THREAD, `Follow-up ${i + 1} on the checklist.`)
    await row.expectUnread(40)

    await row.open()
    await juno.topic.expectDividerBefore('Follow-up 1 on the checklist.')
    await juno.topic.expectThumbnailsLoaded()
    // The list runs under the 68px band, so 80px below it is 148px from the list's top.
    expect(Math.round(await juno.topic.dividerOffset())).toBe(148)
    await juno.topic.expectNew(40)

    // Up to the top: the next page goes in above the rows in view, which stay put.
    const before = await juno.topic.rowCount()
    let anchor = await juno.topic.firstVisibleRow()
    const report = await measureLayoutShift(
      juno.win,
      async () => {
        await juno.topic.scrollToTop()
        anchor = await juno.topic.firstVisibleRow()
        await expect.poll(() => juno.topic.rowCount(), { timeout: 15_000 }).toBeGreaterThan(before)
      },
      { root: '[data-topic-view]', settleMs: 200 },
    )
    expect(await juno.topic.rowTop(anchor.ts)).toBeCloseTo(anchor.top, 0)
    expect(report.shifts).toEqual([])
  })
})

async function headerFeedback({ juno, win }: Pick<Fixtures, 'juno' | 'win'>): Promise<void> {
  await juno.sidebar.row(POSTGRES).open()
  await juno.topic.expectTitle(POSTGRES)
  const header = juno.topic.header
  const controls = [
    header.getByRole('button', { name: 'Resolve', exact: true }),
    juno.topic.titleButton,
    header.getByRole('button', { name: /Show in sidebar/ }),
    header.getByRole('button', { name: 'Juno ⌘J' }),
    juno.topic.moreButton,
  ]
  const look = (control: (typeof controls)[number]) =>
    control.evaluate((element) => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, scale: style.scale }
    })
  const away = () => win.mouse.move(5, 300)

  for (const control of controls) {
    // Every control is there: a removed one fails.
    await expect(control).toBeVisible()
    const name = (await control.getAttribute('aria-label')) ?? (await control.textContent())
    await away()
    const rest = await look(control)
    await control.hover()
    await expect.poll(async () => (await look(control)).background, { message: `hover on ${name}` }).not.toBe(rest.background)
    // Menu triggers open on press; capture them instead of leaving a native menu open.
    await juno.chooseNextMenuItem(null)
    await win.mouse.down()
    await expect.poll(async () => (await look(control)).background, { message: `press on ${name}` }).not.toBe(rest.background)
    expect((await look(control)).scale).toBe(rest.scale)
    // Release away so buttons that act on click do not run.
    await away()
    await win.mouse.up()
  }
}
