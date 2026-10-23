import { expect, test, type Page } from '@playwright/test'
import { openState } from './support'

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })

test('Home keeps the syncing line under the greeting as its copy changes', async ({ page }) => {
  const starts: Array<{ readonly greeting: number; readonly line: number; readonly first: number }> = []
  for (const [state, copy] of [
    ['empty/syncing', 'Syncing with Slack.'],
    ['empty/syncing-count', /^Syncing\s*7\s*of 143 conversations\.$/],
  ] as const) {
    await open(page, 'Home', state)
    const line = page.locator('[data-home] h2 + p')
    await expect(line).toHaveText(copy)
    starts.push(await line.evaluate((node) => {
      const range = document.createRange()
      range.setStart(node.firstChild!, 0)
      range.setEnd(node.firstChild!, 1)
      return { greeting: node.previousElementSibling!.getBoundingClientRect().left, line: node.getBoundingClientRect().left, first: range.getBoundingClientRect().left }
    }))
  }
  for (const start of starts) expect(start.line).toBe(start.greeting)
  expect(starts[1]!.first).toBe(starts[0]!.first)
})
