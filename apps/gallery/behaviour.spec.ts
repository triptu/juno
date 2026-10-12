import { expect, test, type Page } from '@playwright/test'

interface Route {
  readonly component: string
  readonly fixture: string
}

/**
 * Behaviour that a screenshot cannot show, checked against the built gallery
 * in a real browser: mouse-down activation and the cursor rule.
 */
const log = (page: Page) => page.locator('[data-activation-log]')

test.describe('mouse-down activation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/ListRow/activation')
    await expect(page.getByRole('button', { name: /Postgres 16 migration plan/ })).toBeVisible()
  })

  test('activates on the primary button going down, before the click', async ({ page }) => {
    const row = page.getByRole('button', { name: /Postgres 16 migration plan/ })
    const box = (await row.boundingBox())!
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.down()
    await expect(log(page)).toHaveText('row:pointer')
    await page.mouse.up()
    // The click that follows the release does not activate again.
    await expect(log(page)).toHaveText('row:pointer')
  })

  test('passes the command key through for open in new tab', async ({ page }) => {
    const row = page.getByRole('button', { name: /Postgres 16 migration plan/ })
    await row.click({ modifiers: ['Meta'] })
    await expect(log(page)).toHaveText('row:pointer:meta')
  })

  test('ignores ctrl-click and the secondary button', async ({ page }) => {
    const row = page.getByRole('button', { name: /Postgres 16 migration plan/ })
    // On macOS Chromium turns ctrl-click into a context menu, like the OS.
    await row.click({ modifiers: ['Control'] })
    await row.click({ button: 'right' })
    await expect(log(page)).toContainText('row:contextmenu')
    await expect(log(page)).not.toContainText('row:pointer')
  })

  test('leaves a press on a nested control to that control', async ({ page }) => {
    await page.getByRole('button', { name: 'Resolve', exact: true }).click()
    await expect(log(page)).toHaveText('resolve:click')
  })

  test('activates from the keyboard with Enter', async ({ page }) => {
    await page.getByRole('button', { name: /Postgres 16 migration plan/ }).focus()
    await page.keyboard.press('Enter')
    await expect(log(page)).toHaveText('row:keyboard')
  })
})

/**
 * SPEC section 16: the arrow cursor everywhere, the text cursor only over
 * editable or selectable text, never the pointer. Checked on every fixture
 * in the light theme: an element may compute `cursor: text` only when it
 * also computes `user-select: text`, or when it is part of a field (a label
 * wrapping an input), which focuses the input wherever it is clicked.
 */
test('no fixture shows the pointer, and the text cursor only over selectable text', async ({ page }) => {
  await page.goto('/#/')
  const routes = await page.evaluate(() => (window as unknown as { __galleryRoutes: ReadonlyArray<Route> }).__galleryRoutes)
  expect(routes.length).toBeGreaterThan(0)

  const offenders: string[] = []
  for (const route of routes) {
    const name = `${route.component}/${route.fixture}`
    await page.goto(`/#/${encodeURIComponent(route.component)}/${encodeURIComponent(route.fixture)}`)
    await expect(page.locator(`[data-fixture-frame="${name}"]`)).toBeVisible()
    const hits = await page.evaluate((name) => {
      const frame = document.querySelector(`[data-fixture-frame="${name}"]`)
      if (!frame) return ['no frame']
      const bad: string[] = []
      for (const element of Array.from(frame.querySelectorAll('*'))) {
        const style = getComputedStyle(element)
        const describe = () => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[cursor=${style.cursor}]`
        if (style.cursor === 'pointer') bad.push(describe())
        const inField = element.closest('label') !== null && element.closest('label')!.querySelector('input, textarea') !== null
        if (style.cursor === 'text' && style.userSelect !== 'text' && !inField) bad.push(describe())
      }
      return bad
    }, name)
    for (const hit of hits) offenders.push(`${name}: ${hit}`)
  }
  expect(offenders).toEqual([])
})
