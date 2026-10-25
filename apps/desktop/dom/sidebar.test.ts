// The sidebar against the fake Slack: the Unread filter keeps a read topic while a tab shows
// it (SPEC 5, "Holding the order"). That the opened row's box holds still is the browser
// lane's layout-shift guard; here the order and the rows.
import { expect } from './expect'
import { domTest } from './test'

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'

domTest('Unread keeps read topics until no tab shows them', async ({ juno }) => {
  const { sidebar, tabs } = juno
  await sidebar.toggleUnread()
  const rina = sidebar.row(RINA)
  const roadmap = sidebar.row(ROADMAP)
  await rina.expectUnread(2)
  const before = await sidebar.titles()
  await rina.open()
  await rina.expectRead()
  await rina.expectSelected()
  expect(await sidebar.titles()).toEqual(before)

  await roadmap.open()
  await roadmap.expectRead()
  await roadmap.expectSelected()
  // Rina's row leaves once the pointer leaves the list, which holds its rows meanwhile.
  await expect(rina.root).toHaveCount(1)
  await sidebar.leave()
  await expect(rina.root).toHaveCount(0)

  // Two tabs show the same read topic. Closing one must leave its row.
  await roadmap.openInNewTab()
  await tabs.expectCount(2)
  await tabs.menu('close-tab')
  await tabs.expectCount(1)
  await roadmap.expectRead()
  await roadmap.expectSelected()
  await tabs.menu('close-tab')
  await sidebar.leave()
  await expect(roadmap.root).toHaveCount(0)
})

domTest('pressing a row selects it, the keyboard moves the selection, and arrowing to a row only focuses it', async ({ juno, fake, step }) => {
  const { sidebar, win } = juno
  await step('pressing a row selects it, and the keyboard moves the selection', async () => {
    const titles = await sidebar.titles('Recent')
    const first = sidebar.row(titles[0]!)
    const second = sidebar.row(titles[1]!)
    const third = sidebar.row(titles[2]!)

    await second.select()
    await second.expectSelected()
    await first.expectSelected(false)
    // An open from a row keeps focus on that row (SPEC 6, "Ready to type").
    await second.expectFocused()

    // Arrows move focus between rows; Enter makes the focused row the selection.
    await second.focus()
    await win.keyboard.press('ArrowDown')
    await third.expectFocused()
    await win.keyboard.press('Enter')
    await third.expectSelected()
    await second.expectSelected(false)

    await win.keyboard.press('ArrowUp')
    await win.keyboard.press('ArrowUp')
    await first.expectFocused()
    await win.keyboard.press('End')
    await sidebar.row(titles[titles.length - 1]!).expectFocused()
    await win.keyboard.press('Home')
    await first.expectFocused()
    // One row is in the Tab order: the one focused last, so Tab leaves the list and Shift-Tab comes back to it.
    await expect(first.root).toHaveAttribute('tabindex', '0')
    await expect(third.root).toHaveAttribute('tabindex', '-1')
  })
  // Let go of the list, pointer and focus, so it no longer holds its order and the next row can move to the top.
  win.active?.blur()
  await sidebar.leave()
  await step('arrowing to a row focuses it without selecting it', async () => {
    // A new message in #incidents' Main puts its row above the Postgres thread.
    fake.injectMessage({ channel: 'C0INCIDENTS', user: 'U0JONAS', text: 'Paging drill at 3pm.' })
    await sidebar.expectTop('#incidents')
    const titles = await sidebar.titles('Recent')
    const first = sidebar.row(titles[0]!)
    const postgres = sidebar.row(POSTGRES)
    const steps = titles.findIndex((title) => title.startsWith(POSTGRES))
    expect(steps).toBeGreaterThan(0)

    // The first row is selected; the Postgres thread is reached with the keyboard only.
    await first.select()
    await first.expectSelected()
    await first.expectFocused()
    for (let i = 0; i < steps; i++) await win.keyboard.press('ArrowDown')
    await postgres.expectFocused()
    await postgres.expectSelected(false)
  })
})
