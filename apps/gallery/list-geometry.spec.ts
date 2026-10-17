import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Lists and cards from the 10-17 design review: the topic switcher opens on
 * the topic on screen, only one option row is filled while the current one is marked,
 * and a Juno card's header reads as one meta line.
 */

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

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

test('a card header reads as one meta line: the dot after the kind has the kind’s size and baseline', async ({ page }) => {
  for (const [component, id] of [['ChangeCard', 'change/asked-delete'], ['ConnectCard', 'connect/open']] as const) {
    await open(page, component, id)
    const parts = await page.evaluate(() =>
      [...document.querySelectorAll('[data-chat-card] *')]
        .filter((el) => el.children.length === 0 && el.textContent!.trim() !== '')
        .slice(0, 3)
        .map((el) => ({ text: el.textContent!.trim(), size: getComputedStyle(el).fontSize, bottom: Math.round(el.getBoundingClientRect().bottom) })),
    )
    expect(parts[1]!.text, id).toBe('·')
    expect(parts[1]!.size, id).toBe(parts[0]!.size)
    expect(parts[1]!.bottom, id).toBe(parts[0]!.bottom)
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

test('two-line picker rows are 44px, and Main’s title starts on the threads’ edge', async ({ page }) => {
  for (const [component, id] of [['TopicHeader', 'switcher/switcher-thread']] as const) {
    await open(page, component, id)
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"]')].map((row) => {
        const box = row.getBoundingClientRect()
        const range = document.createRange()
        const text = [...row.querySelectorAll('span')].find((span) => span.children.length === 0 && span.textContent!.trim() !== '')!
        range.selectNodeContents(text)
        return { height: box.height, titleStart: Math.round(range.getBoundingClientRect().left - box.left) }
      }),
    )
    expect(rows.length, id).toBeGreaterThan(2)
    for (const row of rows) expect(row.height, id).toBe(44)
    expect(new Set(rows.map((row) => row.titleStart)).size, id).toBe(1)
  }
})

test('a Juno card’s default button is the last, at the trailing edge, as on the Mac', async ({ page }) => {
  const states = [
    ['ChangeCard', 'change/open'],
    ['ConnectCard', 'connect/open'],
    ['BudgetCard', 'budget/open'],
    ['ScheduleCard', 'schedule/open'],
    ['ProposedTaskCard', 'proposed-task/open'],
    ['TaskCard', 'task/lost-sight'],
    ['RemoveCard', 'remove/open'],
  ] as const
  for (const [component, id] of states) {
    await open(page, component, id)
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll('[data-chat-card] button')]
        .filter((button) => button.getAttribute('aria-label') === null)
        .map((button) => getComputedStyle(button).backgroundColor !== 'rgba(0, 0, 0, 0)'),
    )
    expect(buttons.length, id).toBeGreaterThan(1)
    // Only the default button is filled, and it comes last.
    expect(buttons.indexOf(true), id).toBe(buttons.length - 1)
  }
})

test('the avatar menu’s Sign out starts on the account line’s edge', async ({ page }) => {
  await open(page, 'AccountMenu', 'sections/with-session')
  const edges = await page.evaluate(() => {
    const start = (el: Element) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return Math.round(range.getBoundingClientRect().left)
    }
    const section = document.querySelector('section[aria-label="Session"] section[aria-label="Session"]')!
    return { line: start(section.querySelector('p')!), signOut: start(section.querySelector('button')!) }
  })
  expect(edges.signOut).toBe(edges.line)
})

test('Configure: tool rows are 56px, the list is seven of them, and no rule sits on its bottom edge', async ({ page }) => {
  await open(page, 'ConnectionToolsSheet', 'configure/tools')
  const at = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-tool]')]
    const list = rows[0]!.parentElement!
    return {
      heights: rows.map((row) => row.getBoundingClientRect().height),
      list: list.clientHeight,
      bottomRules: rows.map((row) => getComputedStyle(row).borderBottomWidth),
    }
  })
  for (const height of at.heights) expect(height).toBe(56)
  expect(at.list).toBe(7 * 56)
  for (const rule of at.bottomRules) expect(rule).toBe('0px')
})

test('sidebar times end at the row’s trailing edge, short or long', async ({ page }) => {
  await open(page, 'Sidebar', 'list/default')
  const ends = await page.evaluate(() =>
    [...document.querySelectorAll('[data-topic-row]')].flatMap((row) => {
      const time = [...row.querySelectorAll('span')].find((span) => span.children.length === 0 && /^(\d+[mhd]|Yesterday|Now)$/.test(span.textContent!.trim()))
      if (time === undefined) return []
      const range = document.createRange()
      range.selectNodeContents(time)
      return [Math.round(row.getBoundingClientRect().right - range.getBoundingClientRect().right)]
    }),
  )
  expect(ends.length).toBeGreaterThan(3)
  expect(new Set(ends).size).toBe(1)
})

test('Configure: a New or Changed mark is a tag after the tool’s name, on the name’s line, and the row stays 56px', async ({ page }) => {
  await open(page, 'ConnectionToolsSheet', 'configure/changed-and-new')
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tool][data-tool-mark]')].map((row) => {
      const tagElement = row.querySelector('[data-tool-tag]')!
      const tag = tagElement.getBoundingClientRect()
      const name = tagElement.previousElementSibling!.getBoundingClientRect()
      return { height: row.getBoundingClientRect().height, after: tag.left > name.right, middle: Math.round(tag.top + tag.height / 2 - (name.top + name.height / 2)) }
    }),
  )
  expect(rows).toHaveLength(2)
  for (const row of rows) expect(row).toEqual({ height: 56, after: true, middle: 0 })
})

test('every Main row (DM, group DM, channel) is two lines and shorter, with even padding; threads are three lines', async ({ page }) => {
  await open(page, 'TopicRow', 'sidebar/mixed-rows')
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-topic-row]')].map((row) => {
      const box = row.getBoundingClientRect()
      const body = row.children[1]!
      const lines = [...body.children].map((line) => line.getBoundingClientRect())
      const style = getComputedStyle(row)
      return {
        lines: Number(row.dataset.rowLines),
        drawn: lines.length,
        height: box.height,
        // The lines fill the content box exactly: the fixed height is their sum.
        fill: Math.round((lines.at(-1)!.bottom - box.top - parseFloat(style.paddingTop)) * 100) / 100,
        content: box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
        place: row.querySelector('[data-row-part="place"]') !== null,
        main: [...row.querySelectorAll('span')].some((span) => span.children.length === 0 && span.textContent === 'Main'),
      }
    }),
  )
  // Maya's DM, Dev's DM, the group DM, a DM thread, #eng's Main, two channel threads.
  expect(rows.map((row) => row.lines)).toEqual([2, 2, 2, 3, 2, 3, 3])
  for (const row of rows) {
    expect(row.drawn).toBe(row.lines)
    expect(row.height).toBe(row.lines === 2 ? 58 : 80)
    expect(row.fill).toBeGreaterThan(row.content - 1)
    expect(row.fill).toBeLessThanOrEqual(row.content)
    expect(row.place).toBe(row.lines === 3)
  }
  // No row says Main: it is the default.
  expect(rows.some((row) => row.main)).toBe(false)
})

test('the people sit beside the count on the preview line, 8px before it, and show whole', async ({ page }) => {
  await open(page, 'TopicRow', 'sidebar/mixed-rows')
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-topic-row]')].map((row) => {
      const people = row.querySelector('[data-row-part="people"]')
      const counts = row.querySelector('[data-row-part="counts"]')
      const preview = row.querySelector('[data-row-part="preview"]')!.getBoundingClientRect()
      const line = row.querySelector('[data-row-part="preview"]')!.parentElement!.getBoundingClientRect()
      const middle = (box: DOMRect) => Math.round((box.top + box.height / 2) * 2) / 2
      if (people === null) return { people: false, previewToEnd: Math.round(line.right - preview.right), counts: counts !== null }
      const stack = people.getBoundingClientRect()
      const count = counts!.getBoundingClientRect()
      return {
        people: true,
        gap: Math.round((count.left - stack.right) * 100) / 100,
        sameLine: middle(stack) === middle(count),
        countAtEnd: Math.round(line.right - count.right),
        whole: people.scrollWidth <= Math.ceil(stack.width),
        previewBefore: preview.right <= stack.left,
      }
    }),
  )
  const withPeople = rows.filter((row) => row.people)
  expect(withPeople.length).toBe(3)
  for (const row of withPeople) expect(row).toMatchObject({ gap: 8, sameLine: true, countAtEnd: 0, whole: true, previewBefore: true })
  // No people and no count: nothing is kept for them, the preview runs to the line's end.
  for (const row of rows.filter((row) => !row.people && !row.counts)) expect(row.previewToEnd).toBe(0)
})
