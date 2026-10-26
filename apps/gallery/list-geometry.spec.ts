import { expect, type Page } from '@playwright/test'
import { openState, test } from './support'

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })

test('the topic switcher opens on the topic on screen: one row lit, not that one and Main', async ({ page }) => {
  for (const id of ['switcher/switcher-thread', 'switcher/switcher-main']) {
    await open(page, 'TopicHeader', id)
    const rows = await page.evaluate(() => {
      const search = document.querySelector('[data-topic-switcher] input')!
      return [...document.querySelectorAll('[data-topic-switcher] [role="option"]')].map((row) => ({
        selected: row.getAttribute('aria-selected') === 'true',
        active: row.id === search.getAttribute('aria-activedescendant'),
        lit: getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)',
      }))
    })
    const selected = rows.filter((row) => row.selected)
    expect(selected, id).toHaveLength(1)
    expect(selected[0]!.active, id).toBe(true)
    expect(rows.filter((row) => row.lit), id).toHaveLength(1)
  }
})

test('only the keyboard or pointer row is filled; the current row is marked with accent text and a check', async ({ page }) => {
  await open(page, 'TopicHeader', 'switcher/switcher-thread')
  const read = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-topic-switcher] [role="option"]')]
      const probe = document.createElement('span')
      probe.style.color = 'var(--hl-text)'
      document.body.append(probe)
      const accent = getComputedStyle(probe).color
      probe.remove()
      const current = rows.find((row) => row.getAttribute('aria-selected') === 'true')!
      return {
        filled: rows.filter((row) => getComputedStyle(row).backgroundColor !== 'rgba(0, 0, 0, 0)').map((row) => row.id),
        current: current.id,
        checked: current.querySelectorAll('svg').length > 0,
        // The first element with text of its own is the title.
        title: getComputedStyle([...current.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent!.trim() !== '')!).color,
        accent,
      }
    })
  // It opens on the current row: that row is the one filled.
  const opened = await read()
  expect(opened.filled).toEqual([opened.current])
  expect(opened.checked).toBe(true)
  expect(opened.title).toBe(opened.accent)
  // The pointer on Main fills Main alone; the current row keeps only its mark.
  await page.locator('[data-topic-switcher] [role="option"]').first().hover()
  const moved = await read()
  expect(moved.filled).toHaveLength(1)
  expect(moved.filled[0]).not.toBe(moved.current)
})
