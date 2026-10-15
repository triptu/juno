import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Lists and cards from the 10-17 design review: the topic switcher opens on
 * the topic on screen, a selected option row keeps its second line readable,
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

test('a selected option row prints its second line in the subtle colour, which keeps 4.5:1 on the fill', async ({ page }) => {
  await open(page, 'TopicHeader', 'switcher/switcher-thread')
  const colours = await page.evaluate(() => {
    const row = document.querySelector('[data-topic-switcher] [role="option"][aria-selected="true"]')!
    const lines = [...row.querySelectorAll('span')].filter((span) => span.children.length === 0 && /repl/.test(span.textContent!))
    const probe = document.createElement('span')
    probe.style.color = 'var(--foreground-subtle)'
    document.body.append(probe)
    const subtle = getComputedStyle(probe).color
    probe.remove()
    return { line: getComputedStyle(lines[0]!).color, subtle }
  })
  expect(colours.line).toBe(colours.subtle)
})

test('two-line picker rows are 44px, and Main’s title starts on the threads’ edge', async ({ page }) => {
  for (const [component, id] of [['TopicHeader', 'switcher/switcher-thread'], ['NewChat', 'flow/thread-list']] as const) {
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
