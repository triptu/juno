import { expect, test, type Page } from '@playwright/test'
import { openState, type Route } from './support'

/**
 * Tables in messages (SPEC 7, "Tables"): a column Slack wraps wraps so the
 * table fits the message, copying rows of a table gives tab-separated
 * lines, and the scroll box is a tab stop only on the list's tabbable row.
 */

const open = (page: Page, id: string) =>
  openState(page, { component: 'Message', id, route: `Message/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route)

test('a wrapped column wraps so the table fits a narrow message; an unwrapped one keeps its width, so a wide table scrolls', async ({ page }) => {
  await open(page, 'table/wrapped')
  const box = page.locator('[data-msg-table]')
  const fit = await box.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth, body: element.closest('[data-msg-text]')!.clientWidth }))
  expect(fit.scroll).toBeLessThanOrEqual(fit.client)
  expect(fit.client).toBeLessThanOrEqual(fit.body)
  // The id stays on one line; the description takes several.
  const lines = (name: string | RegExp) => box.getByRole('cell', { name }).evaluate((cell) => {
    const range = document.createRange()
    range.selectNodeContents(cell)
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
  })
  expect(await lines('OPS-410')).toBe(1)
  expect(await lines(/^Certificates expire/)).toBeGreaterThan(1)

  // The wide table's unwrapped columns alone are wider than the message.
  await open(page, 'table/wide')
  const wide = await box.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }))
  expect(wide.scroll).toBeGreaterThan(wide.client)
})

test('copying a selection inside a table gives its rows as tab-separated lines, a tab and a break in a cell as spaces', async ({ page }) => {
  await open(page, 'table/copy-cell')
  const copied = await page.locator('[data-msg-table] table').evaluate((table) => {
    const rows = table.querySelectorAll('tr')
    const range = document.createRange()
    range.setStart(rows[1]!.cells[1]!.firstChild!, 1)
    range.setEnd(rows[2]!.cells[0]!.firstChild!, 2)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const data = new DataTransfer()
    rows[1]!.cells[1]!.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
    return data.getData('text/plain')
  })
  expect(copied).toBe('Deploy\tRun migrate then restart\nVerify\tCheck the dashboards')
})

test('the scroll box is a tab stop only on the tabbable row', async ({ page }) => {
  await open(page, 'table/wide-not-tabbable')
  await expect(page.locator('[data-msg-table]')).toHaveAttribute('tabindex', '-1')
  await open(page, 'table/wide')
  await expect(page.locator('[data-msg-table]')).not.toHaveAttribute('tabindex', /.*/)
})

test('the gallery ships its StyleX sheet minified, as the app does', async ({ page }) => {
  await open(page, 'table/status')
  const sheets = await page.evaluate(async () => Promise.all([...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(async (link) => (await fetch(link.href)).text())))
  const stylex = sheets.filter((css) => css.includes('@layer priority'))
  expect(stylex.length).toBeGreaterThan(0)
  for (const css of stylex) expect(css).not.toMatch(/\{\n\s+[a-z-]+:/)
})
