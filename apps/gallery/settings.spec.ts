import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Settings' geometry (inventory 14): the section list keeps the sidebar's
 * inset on both sides and starts on the section title's top edge, and the
 * section sits in the settings column, where the old Notifications page
 * put its column and title.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

test.describe('Settings', () => {
  /** The list's rows against its content box (inside its right hairline), and the open section's title and column, from the frame's top left. */
  const measure = (page: Page) =>
    page.evaluate(() => {
      const frame = document.querySelector('[data-fixture-frame]')!.getBoundingClientRect()
      const title = document.querySelector('[data-fixture-frame] h1')!
      const column = title.closest('header')!.parentElement!
      const scroller = column.parentElement!
      const nav = document.querySelector('[data-settings-nav]')
      const navBox = nav?.getBoundingClientRect()
      const navRight = nav === null ? 0 : navBox!.right - parseFloat(getComputedStyle(nav).borderRightWidth)
      const rows = nav === null ? [] : [...nav.querySelectorAll('[role="button"]')].map((row) => row.getBoundingClientRect())
      const box = column.getBoundingClientRect()
      const area = scroller.getBoundingClientRect()
      return {
        rows: rows.map((row) => ({ left: row.left - navBox!.left, right: navRight - row.right, top: row.top - frame.top })),
        titleTop: title.getBoundingClientRect().top - frame.top,
        titleInPage: title.getBoundingClientRect().top - area.top,
        column: { width: box.width, left: box.left - area.left, right: area.right - (scroller.offsetWidth - scroller.clientWidth) - box.right },
      }
    })

  for (const id of ['sections/general', 'sections/notifications', 'sections/juno', 'sections/ai-activity', 'sections/backup', 'sections/about']) {
    test(`${id}: the section list keeps the sidebar's 10px inset on both sides, and its first row starts on the title's top edge`, async ({ page }) => {
      await open(page, 'SettingsPage', id)
      const at = await measure(page)
      expect(at.rows).toHaveLength(9)
      for (const row of at.rows) expect({ left: row.left, right: row.right }).toEqual({ left: 10, right: 10 })
      expect(at.rows[0]!.top).toBe(at.titleTop)
      // The settings column: 760 wide, centred in the space beside the list.
      expect(at.column.width).toBe(760)
      expect(at.column.left).toBe(at.column.right)
    })
  }

  test('the column and its title sit where the old Notifications page put them: the same width and top edge', async ({ page }) => {
    await open(page, 'NotificationsPage', 'page/default')
    const alone = await measure(page)
    await open(page, 'SettingsPage', 'sections/notifications')
    const inSettings = await measure(page)
    expect(inSettings.column.width).toBe(alone.column.width)
    expect(inSettings.titleInPage).toBe(alone.titleInPage)
  })
})

/** How far each group card's content starts from the card's leading edge: the leftmost text or control. */
const leadingInsets = (page: Page) =>
  page.evaluate(() => {
    const column = document.querySelector('[data-fixture-frame] h1')!.closest('header')!.parentElement!
    const style = getComputedStyle(column)
    const width = column.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const cards = [...column.querySelectorAll('*')].filter(
      (el) => el.getBoundingClientRect().width === width && getComputedStyle(el).borderTopLeftRadius !== '0px',
    )
    return cards.map((card) => {
      const left = card.getBoundingClientRect().left
      const starts: number[] = []
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent!.trim() === '') continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const box = range.getBoundingClientRect()
        if (box.width > 0) starts.push(box.left)
      }
      for (const control of card.querySelectorAll('input, [role="radiogroup"], svg')) {
        const box = control.getBoundingClientRect()
        if (box.width > 0) starts.push(box.left)
      }
      return Math.round(Math.min(...starts) - left)
    })
  })

test('every card in General, Appearance, Ignored and About starts its rows 15px in, as the Juno rows do', async ({ page }) => {
  await open(page, 'SettingsPage', 'sections/juno')
  const [juno] = await leadingInsets(page)
  expect(juno).toBe(15)
  for (const id of ['sections/general', 'sections/appearance', 'sections/ignored', 'sections/about']) {
    await open(page, 'SettingsPage', id)
    const insets = await leadingInsets(page)
    expect(insets.length, id).toBeGreaterThan(0)
    for (const inset of insets) expect(inset, id).toBe(juno)
  }
})

test('General and Appearance put each control at the trailing edge, 15px from the card, as the Juno rows do', async ({ page }) => {
  for (const id of ['sections/general', 'sections/appearance']) {
    await open(page, 'SettingsPage', id)
    const ends = await page.evaluate(() =>
      [...document.querySelectorAll('[data-fixture-frame] [role="radiogroup"], [data-fixture-frame] [role="group"]')].map((control) => {
        let card = control.parentElement!
        while (getComputedStyle(card).borderTopLeftRadius === '0px') card = card.parentElement!
        return Math.round(card.getBoundingClientRect().right - control.getBoundingClientRect().right)
      }),
    )
    expect(ends.length, id).toBeGreaterThan(0)
    for (const end of ends) expect(end, id).toBe(15)
  }
})

test('a saved API key looks the same in Set up Juno and Settings › Juno: the Key set chip beside the field, which keeps its placeholder', async ({ page }) => {
  const read = () =>
    page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>('[data-fixture-frame] input[type="password"]')!
      const chip = [...document.querySelectorAll('[data-fixture-frame] span')].find((span) => span.children.length === 0 && span.textContent === 'Key set')
      return { placeholder: field.placeholder, chipBeforeField: chip !== undefined && chip.getBoundingClientRect().right <= field.getBoundingClientRect().left }
    })
  await open(page, 'SetUpJunoView', 'openrouter/model-chosen')
  const setUp = await read()
  await open(page, 'SettingsPage', 'sections/juno')
  expect(setUp).toEqual(await read())
  expect(setUp).toEqual({ placeholder: 'sk-or-…', chipBeforeField: true })
})
