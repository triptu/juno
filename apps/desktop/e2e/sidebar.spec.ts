// The sidebar against the fake Slack: what shows after sign-in, the quick
// filters, a live update from another client, hover and keyboard, and dark
// mode. The rows asserted on are threads the self user follows (started,
// replied in, or was mentioned in) and a channel's Main, so they stay in
// the sidebar under the followed-threads rule as well as the older
// every-active-thread rule.
import type { Page } from '@playwright/test'
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { expect, test } from './fixtures'

// Every test signs in and waits for the sync before it looks at rows.
test.describe.configure({ timeout: 60_000 })

// Titles are the first six words of the root message, so a prefix is enough.
const POSTGRES = 'Draft plan is in the doc.'
const RINA = 'Rina finished the onsite.'
const ROADMAP = 'Proposal: cut offline mode and public'
const OFFSITE = 'Can eng take the Wednesday afternoon'
const ALERTS_MAIN = '#alerts-prod'

/** Resolves a CSS custom property to the colour Chromium computes for it. */
async function resolveColorVar(win: Page, name: string): Promise<string> {
  return win.evaluate((variable) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${variable})`
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  }, name)
}

function brightness(rgb: string): number {
  const [r = 0, g = 0, b = 0] = rgb.match(/\d+/g)?.map(Number) ?? []
  return (r + g + b) / 3
}

test('after sign-in the sidebar lists followed threads and Main, newest first, with tags and counts', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno

  // Nothing is pinned yet, so there is one section and no "Recent" label over it.
  await sidebar.expectNoSection('Pinned')
  await expect(sidebar.section('Recent').getByRole('heading', { name: 'Recent' })).toHaveCount(0)

  // A thread the user replied in: read, so a medium title and no count.
  const postgres = sidebar.row(POSTGRES)
  await postgres.expectVisible()
  await postgres.expectRead()
  await postgres.expectPreview('Dev: Booked 2–4pm. Will post results here.')
  await postgres.expectChannel('eng')
  await postgres.expectMessageCount(7)
  // The participant stack names everyone in it (the fake's display names are first names).
  await expect(postgres.root.getByRole('img', { name: /Dev.*Leo/ })).toBeVisible()

  // A thread with an unread mention: semibold title, the @ tag, then the count.
  const rina = sidebar.row(RINA)
  await rina.expectUnread(2)
  await rina.expectMention()
  await rina.expectChannel('hiring')

  // A thread with unread replies and a mention in the latest one.
  const roadmap = sidebar.row(ROADMAP)
  await roadmap.expectUnread(3)
  await roadmap.expectMention()
  await roadmap.expectPreview(/^Maya: Draft is up\. Cross-posting to #leadership once @Tushar has looked\./)

  // A channel's Main: the channel label as the title and the Main tag.
  const alerts = sidebar.row(ALERTS_MAIN)
  await alerts.expectTag('Main')
  await alerts.expectUnread(9)
  await alerts.expectPreview('Grafana: [RESOLVED] queue depth > 5k on billing-consumer')

  // Newest activity first.
  const titles = await sidebar.titles('Recent')
  const at = (prefix: string) => titles.findIndex((title) => title.startsWith(prefix))
  expect(at(ALERTS_MAIN)).toBeGreaterThanOrEqual(0)
  expect(at(ALERTS_MAIN)).toBeLessThan(at(POSTGRES))
  expect(at(POSTGRES)).toBeLessThan(at(RINA))
  expect(at(RINA)).toBeLessThan(at(ROADMAP))
  expect(at(ROADMAP)).toBeLessThan(at(OFFSITE))

  // Both groups have unread topics, so both dots show.
  await sidebar.expectFilterDot('Channels', true)
  await sidebar.expectFilterDot('DMs', true)
})

test('the quick filters narrow the list and the Unread toggle hides read rows', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  await sidebar.row(POSTGRES).expectVisible()
  await sidebar.row(OFFSITE).expectVisible()

  await sidebar.filter('Channels')
  await expect(sidebar.row(OFFSITE).root).toHaveCount(0)
  await sidebar.row(POSTGRES).expectVisible()
  // The dot only marks the group that is not being viewed.
  await sidebar.expectFilterDot('Channels', false)
  await sidebar.expectFilterDot('DMs', true)

  await sidebar.filter('DMs')
  await expect(sidebar.row(POSTGRES).root).toHaveCount(0)
  await sidebar.row(OFFSITE).expectVisible()
  await sidebar.expectFilterDot('Channels', true)
  await sidebar.expectFilterDot('DMs', false)

  await sidebar.filter('All')
  await sidebar.row(POSTGRES).expectVisible()

  await sidebar.toggleUnread()
  await expect(sidebar.row(POSTGRES).root).toHaveCount(0)
  await sidebar.row(RINA).expectVisible()
  await sidebar.row(OFFSITE).expectVisible()

  await sidebar.toggleUnread()
  await sidebar.row(POSTGRES).expectVisible()
})

test('the empty state offers to clear the filters', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  await sidebar.row(OFFSITE).expectVisible()

  // Reading the DM threads from another client leaves nothing unread in DMs.
  for (const channel of ['D0MAYA', 'D0SAM', 'G0MAYALEO']) {
    const last = fake.messages(channel).at(-1)!
    fake.markRead({ channel, ts: last.ts })
    for (const root of fake.messages(channel).filter((message) => message.reply_count !== undefined && message.reply_count > 0)) {
      fake.markThreadRead({ channel, threadTs: root.ts, ts: last.ts })
    }
  }
  await sidebar.filter('DMs')
  await sidebar.toggleUnread()
  await sidebar.expectEmpty("You're all caught up")

  await sidebar.list.getByRole('button', { name: 'Clear filters' }).click()
  await expect(sidebar.filterButton('All')).toHaveAttribute('aria-pressed', 'true')
  await expect(sidebar.unreadToggle).toHaveAttribute('aria-pressed', 'false')
  await sidebar.row(POSTGRES).expectVisible()
})

test('a reply from another client updates its row in place and moves it to the top', async ({ juno, fake }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  const postgres = sidebar.row(POSTGRES)
  await postgres.expectVisible()
  await postgres.expectMessageCount(7)
  const before = await sidebar.titles('Recent')
  expect(before[0]).toBe(ALERTS_MAIN)

  const root = fake.messages('C0ENG').find((message) => message.text?.startsWith('Draft plan is in the doc.'))!
  fake.injectMessage({ channel: 'C0ENG', threadTs: root.ts, user: 'U0LEO', text: 'Results look good. Cutover is a go.' })

  await postgres.expectPreview('Leo: Results look good. Cutover is a go.')
  await postgres.expectMessageCount(8)
  await postgres.expectUnread(1)
  await expect.poll(() => sidebar.titles('Recent').then((titles) => titles[0])).toBe(`${POSTGRES}…`)
  // The engine's write reached pixels inside the budget (performance.md 1: 50 ms, plus the 30 ms socket debounce).
  expect(await juno.measure('juno.live-update')).toBeLessThan(80)
})

test('hovering a row shows Resolve in its reserved slot without moving anything', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  const postgres = sidebar.row(POSTGRES)
  await postgres.expectVisible()

  const slot = postgres.resolveButton.locator('..')
  await expect(slot).toHaveCSS('opacity', '0')
  await expectNoLayoutShift(win, () => postgres.hover(), { root: 'aside' })
  await expect(slot).toHaveCSS('opacity', '1')
  await expect(postgres.resolveButton).toHaveAttribute('title', 'Resolve')
  await expect(postgres.resolveButton).toHaveAccessibleName(`Resolve ${POSTGRES}…`)

  // Leaving hides it again; keyboard focus shows it too.
  await expectNoLayoutShift(win, () => win.mouse.move(900, 400), { root: 'aside' })
  await expect(slot).toHaveCSS('opacity', '0')
  await expectNoLayoutShift(win, () => postgres.focus(), { root: 'aside' })
  await expect(slot).toHaveCSS('opacity', '1')
})

test('the list scrollbar shows only while the pointer is over the list, and nothing moves', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  const list = sidebar.list
  const thumb = () => list.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor)
  const width = () => list.evaluate((node) => node.clientWidth)

  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  expect(await thumb()).toBe('rgba(0, 0, 0, 0)')
  const gutterBefore = await width()

  await expectNoLayoutShift(win, () => list.hover({ position: { x: 10, y: 10 } }), { root: 'aside' })
  await expect.poll(thumb).not.toBe('rgba(0, 0, 0, 0)')
  expect(await width()).toBe(gutterBefore)

  // The trackpad and the keyboard still scroll it.
  await win.mouse.wheel(0, 400)
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
  await win.mouse.move(900, 400)
  await expect.poll(thumb).toBe('rgba(0, 0, 0, 0)')
  const top = await list.evaluate((node) => node.scrollTop)
  await sidebar.rows.first().focus()
  await win.keyboard.press('End')
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(top)
})

test('pressing a row selects it, and the keyboard moves the selection', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  const titles = await sidebar.titles('Recent')
  const first = sidebar.row(titles[0]!)
  const second = sidebar.row(titles[1]!)
  const third = sidebar.row(titles[2]!)

  await second.select()
  await second.expectSelected()
  await first.expectSelected(false)

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
  // Only the selected row is in the Tab order.
  await expect(third.root).toHaveAttribute('tabindex', '0')
  await expect(first.root).toHaveAttribute('tabindex', '-1')
})

test('the sidebar renders in dark mode', async ({ juno, win }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { sidebar } = juno
  await sidebar.row(POSTGRES).expectVisible()
  const lightSidebar = await resolveColorVar(win, '--background-subtle')
  await expect(sidebar.root).toHaveCSS('background-color', lightSidebar)

  await sidebar.themeButton.click()
  const darkSidebar = await resolveColorVar(win, '--background-subtle')
  expect(brightness(darkSidebar)).toBeLessThan(brightness(lightSidebar))
  await expect(sidebar.root).toHaveCSS('background-color', darkSidebar)
  await expect(win.getByRole('main')).toHaveCSS('background-color', await resolveColorVar(win, '--background'))
  // The title is still readable: its colour is lighter than the row behind it.
  const title = sidebar.row(POSTGRES).titleText
  expect(brightness(await title.evaluate((node) => getComputedStyle(node).color))).toBeGreaterThan(brightness(darkSidebar))
  await expect(sidebar.themeButton).toHaveAccessibleName('Toggle theme')

  await sidebar.themeButton.click()
  await expect(sidebar.root).toHaveCSS('background-color', lightSidebar)
})
