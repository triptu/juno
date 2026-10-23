import { expect, test, type Page } from '@playwright/test'
import { openState } from './support'

const open = (page: Page, component: string, id: string) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })

test('views do not make the filter row taller or move the list', async ({ page }) => {
    const measure = () =>
      page.evaluate(() => {
        const filters = document.querySelector('[aria-label="Quick filters"]')!.getBoundingClientRect()
        const row = document.querySelector('[data-pill-row]') as HTMLElement
        const list = document.querySelector('[aria-label="Topics"]')!.getBoundingClientRect()
        return { height: filters.height, top: filters.top, listTop: list.top, rowOverflows: row.scrollWidth > row.clientWidth }
      })
    await open(page, 'Sidebar', 'list/default')
    const plain = await measure()
    await open(page, 'Sidebar', 'views/overflowing')
    const views = await measure()
    expect(views.rowOverflows).toBe(true)
    expect(plain.rowOverflows).toBe(false)
    expect({ height: views.height, top: views.top, listTop: views.listTop }).toEqual({ height: plain.height, top: plain.top, listTop: plain.listTop })
  })

test('Backup cuts the path in the middle and keeps the row insets', async ({ page }) => {
  await open(page, 'BackupSection', 'backup/long-path')
  const path = page.locator('[data-backup-folder]')
  await expect(path).toHaveAttribute('title', '/Users/maya/Library/CloudStorage/Dropbox/Workspace archives/Shared folders/Desktop clients/Juno backup')
  await expect(path).toContainText('…')
  await expect(path).toContainText('/Juno backup')
  const at = await path.evaluate((node) => {
    const card = node.closest('[data-backup]')!.getBoundingClientRect()
    const row = node.closest('[data-backup]')!.firstElementChild!
    const button = row.querySelector('button')!.getBoundingClientRect()
    const box = node.getBoundingClientRect()
    return { start: box.left - card.left, end: card.right - button.right, fits: node.scrollWidth <= node.clientWidth, gap: button.left - box.right }
  })
  expect(at.end).toBe(at.start)
  expect(at.fits).toBe(true)
  expect(at.gap).toBeGreaterThan(0)
})

test('row counts end on the time edge at every width, and keep the row height', async ({ page }) => {
  await open(page, 'TopicRow', 'count/all-widths')
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-topic-row]')].map((row) => {
    const time = row.querySelector('[data-row-part="time"]')!.getBoundingClientRect()
    const count = row.querySelector('[data-row-part="counts"] > :last-child')!
    return { count: count.textContent, offset: count.getBoundingClientRect().right - time.right, height: row.getBoundingClientRect().height, lines: row.getAttribute('data-row-lines') }
  }))
  expect(rows.map((row) => row.count)).toEqual(['3', '3', '12', '12', '99+', '99+'])
  for (const row of rows) expect(row.offset).toBe(0)
  for (const lines of ['2', '3']) expect(new Set(rows.filter((row) => row.lines === lines).map((row) => row.height)).size).toBe(1)
})
