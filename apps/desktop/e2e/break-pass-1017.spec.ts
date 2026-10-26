// Break pass of 10-17: what needs a browser's layout and focus. Keys typed
// right after ⌘N, before the destination list's search has focus, reach it in
// order (in the DOM lane the focus moves before the keys arrive, so it passed
// there with the keys not held at all); a narrow window, the destination list
// and switcher in it, Home's field through a send, Esc from Home's lists back
// to their chips, and dark mode's surfaces. The flows of the break pass are in
// the DOM lane (`dom/break-pass-1017*.test.ts`); a mouse press on a tab is in
// tabs.spec.ts. Findings are in docs/reviews/2026-10-17-break-pass.md and
// docs/reviews/2026-10-17-break-pass-b.md.
import { expect, syncedTest, test } from './fixtures'
import type { Juno } from './driver/juno'
import { recordBoxes } from './shiftProbe'

test.describe.configure({ timeout: 120_000 })

const POSTGRES = 'Draft plan is in the doc'
const RINA = 'Rina finished the onsite'
const ROADMAP = 'Proposal: cut offline mode and public'

const setWindowSize = (juno: Juno, width: number, height?: number) => juno.setWindowSize(width, height)

/** ⌘N, then "maya", Enter and a first word, with no wait between them. */
async function newMessageAndType(juno: Juno): Promise<void> {
  await juno.tabs.shortcut('new-message')
  await juno.win.keyboard.type('maya')
  await juno.win.keyboard.press('Enter')
  await juno.win.keyboard.type('Hi')
}

syncedTest('keys right after ⌘N reach the destination list; a narrow window keeps the tab strip and topic inside it, the destination list and topic switcher fit, Esc gives focus back to Home\'s chips, and dark mode leaves no light surface', async ({ juno, fake }) => {
  // First, from the launch's single Home tab: each step types with no wait after the menu command.
  await test.step('keys typed right after ⌘N reach the destination list on Home, a new Home tab when Home has a draft, and a new Home tab from a topic', () => typedAfterNewMessage(juno))
  // Sixty threads in #eng for the switcher.
  for (let i = 0; i < 60; i++) {
    const root = fake.injectMessage({ channel: 'C0ENG', user: 'U0MAYA', text: `Busy day thread number ${i} about things` })
    fake.injectMessage({ channel: 'C0ENG', user: 'U0LEO', text: `Reply ${i}`, threadTs: root.ts })
  }
  await test.step('the tab strip and the topic stay inside a narrow window with many tabs', async () => {
    await setWindowSize(juno, 720, 480)
    await juno.sidebar.row(POSTGRES).open()
    for (const title of [RINA, ROADMAP, '#eng']) await juno.sidebar.row(title).openInNewTab()
    for (let i = 0; i < 6; i++) await juno.tabs.menu('new-tab')
    await juno.sidebar.row(POSTGRES).open()
    expect(await juno.win.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(juno.tabs.newTabButton).toBeInViewport()
    await expect(juno.topic.composer).toBeInViewport()
    await expect(juno.topic.contextPill).toBeInViewport()
  })

  await test.step('in the smallest window the destination list from ⌘N fits above the chip, its search in view', async () => {
    const { write, tabs, win } = juno
    await expect.poll(() => win.evaluate(() => innerHeight)).toBeLessThan(500)
    await tabs.menu('new-message')
    await expect(write.search).toBeFocused()
    // Esc gives focus back to the chip, and Enter there opens the list again.
    await write.search.press('Escape')
    await expect(write.chip).toBeFocused()
    await win.keyboard.press('Enter')
    await expect(write.search).toBeFocused()
    await expect(write.option('Maya')).toBeVisible()
    // In view and not under anything that clips it: the point at its middle is the search itself.
    await expect(write.search).toBeInViewport({ ratio: 1 })
    const hit = await write.search.evaluate((search) => {
      const box = search.getBoundingClientRect()
      const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return at === search
    })
    expect(hit, 'the search is the element at its own middle').toBe(true)
    await win.keyboard.type('jon')
    await win.keyboard.press('Enter')
    await write.expectDestination('Jonas')

    // A send from Home: every frame through it shows one field, in the same place.
    await write.write('Lunch order goes out at noon')
    const before = await write.field.boundingBox()
    const fields = await recordBoxes(win, '[data-composer-field]')
    await write.send()
    await juno.expectToast('Sent to Jonas')
    await expect(write.composer).toHaveValue('')
    expect(await write.field.boundingBox()).toEqual(before)
    const frames = await fields()
    expect(frames.length, 'the field must be sampled in many frames').toBeGreaterThan(1)
    expect(frames.filter((boxes) => boxes.length !== 1 || JSON.stringify(boxes[0]) !== JSON.stringify(before)), `one field at ${JSON.stringify(before)} in every frame`).toEqual([])

    // Esc from the topic list gives focus back to its chip, as Esc from the destination list did above.
    await write.pickConversation('eng', 'eng')
    await write.expectTopic('Main')
    await write.composer.press('Shift+Tab')
    await write.topicChip.press('ArrowDown')
    await expect(write.topicSearch).toBeFocused()
    await write.topicSearch.press('Escape')
    await expect(write.topicChip).toBeFocused()
  })

  await test.step('the topic switcher with many threads keeps the selected row in view and fits the window', async () => {
    await setWindowSize(juno, 1000, 600)
    await juno.sidebar.row('#eng').open()
    await juno.topic.expectMessage('Busy day thread number 59 about things')
    const switcher = await juno.topic.openSwitcherWithKeyboard()
    const box = await switcher.root.boundingBox()
    const height = await juno.win.evaluate(() => innerHeight)
    expect(box!.y + box!.height).toBeLessThanOrEqual(height)
    for (let i = 0; i < 40; i++) await juno.win.keyboard.press('ArrowDown')
    const activeId = await switcher.search.getAttribute('aria-activedescendant')
    expect(activeId).not.toBeNull()
    const active = switcher.root.locator(`[id="${activeId}"]`)
    await expect(active).toContainText('Busy day thread')
    await expect(active).toBeInViewport({ ratio: 1 })
    await juno.win.keyboard.press('Enter')
    await expect(switcher.root).toBeHidden()
  })

  await test.step('dark mode leaves no light surface on Home, the switcher and Settings', async () => {
    await juno.setTheme('Dark')
    const lightSurfaces = () =>
      juno.win.evaluate(() => {
        const light: string[] = []
        for (const element of document.querySelectorAll<HTMLElement>('body *')) {
          // Rows off screen skip style (content-visibility), and hidden actions are at opacity 0.
          if (!element.checkVisibility({ opacityProperty: true, contentVisibilityAuto: true })) continue
          // A toast is paper on ink in dark by design (tokens, "--toast-success"); an earlier step's send left one.
          if (element.closest('[role="status"]')) continue
          const match = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(getComputedStyle(element).backgroundColor)
          if (match === null || (match[4] !== undefined && Number(match[4]) < 0.5)) continue
          const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])]
          if (0.2126 * r + 0.7152 * g + 0.0722 * b > 200) light.push(`${element.tagName.toLowerCase()} "${element.getAttribute('aria-label') ?? element.textContent?.slice(0, 30)}" ${match[0]} in ${element.parentElement?.closest('[aria-label]')?.getAttribute('aria-label')}`)
        }
        return light
      })
    await juno.home.open()
    await expect(juno.write.chip).toBeVisible()
    expect(await lightSurfaces()).toEqual([])
    await juno.write.chip.click()
    await expect(juno.write.list).toBeVisible()
    expect(await lightSurfaces()).toEqual([])
    await juno.win.keyboard.press('Escape')
    await juno.sidebar.row('#eng').open()
    await juno.topic.openSwitcher()
    expect(await lightSurfaces()).toEqual([])
    await juno.win.keyboard.press('Escape')
    await juno.openSettings('General')
    expect(await lightSurfaces()).toEqual([])
  })
})

const DRAFT = 'Half a thought'

async function typedAfterNewMessage(juno: Juno): Promise<void> {
  const { write, tabs, sidebar, topic } = juno

  await test.step('on Home, the keys reach its destination list', async () => {
    await write.composer.focus()
    await newMessageAndType(juno)
    await tabs.expectCount(1)
    await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
  })

  await test.step('on Home with a draft, the keys reach a new Home tab, and the draft is untouched', async () => {
    await write.composer.press('End')
    await write.composer.pressSequentially(`. ${DRAFT}`)
    await newMessageAndType(juno)
    await tabs.expectCount(2)
    await tabs.expectActiveAt('Home', 1)
    await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
    await tabs.selectAt('Home', 0)
    await tabs.expectActiveAt('Home', 0)
    await expect(write.composer).toHaveValue(`Hi. ${DRAFT}`)
    await write.expectDestination('Maya')
    await tabs.selectAt('Home', 1)
    await tabs.menu('close-tab')
    await tabs.expectCount(1)
  })

  await test.step('from a topic, the keys reach a new Home tab', async () => {
    await sidebar.row(POSTGRES).open()
    await topic.expectTitle(POSTGRES)
    await topic.composer.focus()
    await newMessageAndType(juno)
    await tabs.expectCount(2)
    await tabs.expectActiveAt('Home', 0)
    await expect(write.composer).toHaveAttribute('placeholder', 'Message Maya')
    await expect(write.composer).toHaveValue('Hi')
    await expect(write.composer).toBeFocused()
    // Leave the draft in no Home tab, so the steps after start from an empty field.
    await write.composer.fill('')
    await tabs.select(POSTGRES)
    await expect(topic.composer).toHaveValue('')
  })
}
