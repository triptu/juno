import { expect, test, type Page } from '@playwright/test'
import { openState, readRoutes } from './support'

/**
 * Behaviour that a screenshot cannot show, checked against the built gallery
 * in a real browser: mouse-down activation, the cursor rule and the state
 * switcher. Layout shift is in shift.spec.ts.
 */
const log = (page: Page) => page.locator('[data-activation-log]')

test.describe('mouse-down activation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/ListRow?__state=activation/activation')
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
 * A one-line text that is cut off shows its full text as the tooltip when
 * hovered; one that fits shows none. The browser draws the tooltip itself, so
 * the check reads the `title` attribute the hover sets.
 */
test.describe('truncation tooltip', () => {
  const hoverText = async (page: Page, text: string | RegExp) => {
    const node = page.locator('[data-fixture-frame]').getByText(text, { exact: true }).first()
    await node.hover()
    return node
  }
  /** The sender name: the one span with its own direction in the row's header. */
  const hoverName = async (page: Page) => {
    const name = page.locator('[data-message-row] span[dir="auto"]').first()
    await name.hover()
    return name
  }

  test('a cut-off sender name shows the full name', async ({ page }) => {
    await page.goto('/#/Message?__state=row/long-name')
    const name = await hoverName(page)
    await expect(name).toHaveText('Maximilian-Alexander Fitzgerald-Montgomery-Rutherford of the platform team')
    await expect(name).toHaveAttribute('title', 'Maximilian-Alexander Fitzgerald-Montgomery-Rutherford of the platform team')
  })

  test('a name that fits has no tooltip', async ({ page }) => {
    await page.goto('/#/Message?__state=row/group-start')
    const name = await hoverName(page)
    await expect(name).toHaveText('Maya Chen')
    await expect(name).not.toHaveAttribute('title')
  })

  test('a cut-off thread link title shows the full title; one that fits does not', async ({ page }) => {
    await page.goto('/#/ThreadLink?__state=label/long-title')
    const long = await hoverText(page, /^Rotate the staging secrets/)
    await expect(long).toHaveAttribute('title', 'Rotate the staging secrets before the audit, and document where each one lives so nobody has to ask again')
    await page.goto('/#/ThreadLink?__state=label/replies')
    const short = await hoverText(page, 'Staging bill doubled since August')
    await expect(short).not.toHaveAttribute('title')
  })
})

/**
 * A long code block in a message is part of the message, not a scroller of
 * its own: the wheel over it moves the list.
 */
test('the wheel over a long code block scrolls the message list', async ({ page }) => {
  await page.goto('/#/MessageList?__state=content/long-code')
  const scroller = page.locator('[data-fixture-frame] [data-scroll]')
  await expect(scroller).toBeVisible()
  await scroller.evaluate((node) => {
    node.scrollTop = 0
  })
  const block = page.locator('[data-fixture-frame] pre').first()
  await block.scrollIntoViewIfNeeded()
  const before = await scroller.evaluate((node) => node.scrollTop)
  await block.hover()
  await page.mouse.wheel(0, 400)
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(before)
  expect(await block.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(false)
})

/**
 * SPEC section 16: the arrow cursor everywhere, the text cursor only over
 * editable or selectable text, never the pointer. Checked on every fixture
 * in the light theme: an element may compute `cursor: text` only when it
 * also computes `user-select: text`, or when it is part of a field (a label
 * wrapping an input), which focuses the input wherever it is clicked.
 */
test('no state shows the pointer, and the text cursor only over selectable text', async ({ page }) => {
  const routes = await readRoutes(page)

  const offenders: string[] = []
  for (const route of routes) {
    await openState(page, route)
    const hits = await page.evaluate((frameName) => {
      const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)
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
    }, route.route)
    for (const hit of hits) offenders.push(`${route.route}: ${hit}`)
  }
  expect(offenders).toEqual([])
})

test('the gallery chrome keeps the arrow cursor too', async ({ page }) => {
  await page.goto('/#/Button?__state=variant/primary')
  const cursors = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.g-chrome a, .g-chrome select, .g-chrome input')).map((element) => getComputedStyle(element).cursor),
  )
  expect(cursors.length).toBeGreaterThan(0)
  expect(cursors).not.toContain('pointer')
})

/**
 * The state switcher: grouped list, one state at a time, addressable by the
 * `__state` search param, and keyboard driven.
 */
test.describe('state switcher', () => {
  const stateParam = (page: Page) => new URLSearchParams(new URL(page.url()).hash.split('?')[1] ?? '').get('__state')
  /** The address that adds the gallery's own test fixtures (see src/testFixtures.tsx). */
  const testGallery = '/?test-fixtures'
  const componentOf = (page: Page) => page.url().split('#/')[1]?.split('?')[0]

  test('lists a component\'s states under their group headings and marks the open one', async ({ page }) => {
    await page.goto(`${testGallery}#/GalleryTestComponent?__state=extra/last-one`)
    const panel = page.getByRole('navigation', { name: 'Gallery switcher' })
    await expect(panel.getByRole('heading', { name: 'Order', exact: true })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Extra', exact: true })).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Last one', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(panel.getByRole('link', { name: 'Second', exact: true })).not.toHaveAttribute('aria-current', 'true')
    await expect(page.locator('[data-fixture-frame]')).toHaveAttribute('data-fixture-frame', 'GalleryTestComponent/extra/last-one')
    await expect(page.getByText('The last state')).toBeVisible()
  })

  test('shows only the chosen state, and a state link keeps the theme and accent', async ({ page }) => {
    await page.goto(`${testGallery}#/GalleryTestComponent?__state=order/second&theme=dark&accent=claret`)
    const panel = page.getByRole('navigation', { name: 'Gallery switcher' })
    await expect(page.locator('[data-fixture-frame]')).toHaveCount(1)
    await panel.getByRole('link', { name: 'Third', exact: true }).click()
    await expect(page.locator('[data-fixture-frame="GalleryTestComponent/order/third"]')).toBeVisible()
    expect(page.url()).toContain('__state=order/third')
    expect(page.url()).toContain('theme=dark')
    expect(page.url()).toContain('accent=claret')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('opens the first state when none is named, and still understands a bare state key', async ({ page }) => {
    await page.goto(`${testGallery}#/GalleryTestComponent`)
    await expect(page.locator('[data-fixture-frame="GalleryTestComponent/order/first"]')).toBeVisible()
    await page.goto(`${testGallery}#/GalleryTestComponent/second`)
    await expect(page.locator('[data-fixture-frame="GalleryTestComponent/order/second"]')).toBeVisible()
  })

  test('j and k, and the arrow keys, move between states and stop at the ends', async ({ page }) => {
    await page.goto(`${testGallery}#/GalleryTestComponent?__state=order/first`)
    await expect(page.locator('[data-fixture-frame]')).toBeVisible()
    await page.keyboard.press('k')
    await expect.poll(() => stateParam(page)).toBe('order/first')
    await page.keyboard.press('j')
    await expect.poll(() => stateParam(page)).toBe('order/second')
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => stateParam(page)).toBe('order/third')
    // Groups do not stop the walk.
    await page.keyboard.press('j')
    await expect.poll(() => stateParam(page)).toBe('extra/last-one')
    await page.keyboard.press('j')
    await expect.poll(() => stateParam(page)).toBe('extra/last-one')
    await page.keyboard.press('k')
    await expect.poll(() => stateParam(page)).toBe('order/third')
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => stateParam(page)).toBe('order/second')
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => stateParam(page)).toBe('order/first')
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => stateParam(page)).toBe('order/first')
    await expect(page.getByText('The first state', { exact: true })).toBeVisible()
  })

  test('[ and ] switch components, wrapping around', async ({ page }) => {
    await page.goto(`${testGallery}#/GalleryTestComponent`)
    const select = page.getByRole('combobox', { name: 'Component', exact: true })
    await expect(select).toBeVisible()
    const names = await select.locator('option').allTextContents()
    const first = names[0]!
    const last = names.at(-1)!
    await page.goto(`${testGallery}#/${first}?theme=dark`)
    await expect(page.locator('[data-fixture-frame]')).toBeVisible()
    await page.keyboard.press(']')
    await expect.poll(() => componentOf(page)).toBe(names[1])
    expect(page.url()).toContain('theme=dark')
    await page.keyboard.press('[')
    await expect.poll(() => componentOf(page)).toBe(first)
    await page.keyboard.press('[')
    await expect.poll(() => componentOf(page)).toBe(last)
    await page.keyboard.press(']')
    await expect.poll(() => componentOf(page)).toBe(first)
  })

  test('leaves the keys to a field that has focus', async ({ page }) => {
    await page.goto(`${testGallery}#/GalleryTestComponent?__state=order/first`)
    const field = page.getByRole('searchbox', { name: 'Test field', exact: true })
    await field.focus()
    await page.keyboard.type('jk[]')
    expect(stateParam(page)).toBe('order/first')
    await expect(field).toHaveValue('jk[]')
  })

  test('leaves the arrow keys to the component under test', async ({ page }) => {
    await page.goto(`${testGallery}#/GalleryTestComponent?__state=order/first`)
    await page.getByRole('slider').focus()
    await page.keyboard.press('ArrowDown')
    expect(stateParam(page)).toBe('order/first')
    await expect(page.getByRole('slider')).toHaveValue('49')
  })

  test('a narrow window swaps the list for a select above the frame', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 })
    await page.goto(`${testGallery}#/GalleryTestComponent?__state=order/first`)
    await expect(page.getByRole('navigation', { name: 'Gallery switcher' })).toBeHidden()
    const select = page.getByRole('combobox', { name: 'State' })
    await expect(select).toBeVisible()
    await select.selectOption('extra/last-one')
    await expect(page.locator('[data-fixture-frame="GalleryTestComponent/extra/last-one"]')).toBeVisible()
    expect(stateParam(page)).toBe('extra/last-one')
  })

  test('the index lists every component with its state groups', async ({ page }) => {
    await page.goto('/#/')
    await expect(page.getByRole('heading', { name: 'Juno gallery', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'GalleryTestComponent', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'GalleryTestComponentWide', exact: true })).toHaveCount(0)
    await page.goto(`${testGallery}#/`)
    // The component link by its exact name: GalleryTestComponentWide is listed too.
    const entry = page.locator('.g-component').filter({ has: page.getByRole('link', { name: 'GalleryTestComponent', exact: true }) })
    await expect(entry).toHaveCount(1)
    await expect(entry.locator('.g-group-line')).toHaveText(['Order: first, second, third', 'Extra: last one'])
    await entry.getByRole('link', { name: 'second', exact: true }).click()
    await expect(page.locator('[data-fixture-frame="GalleryTestComponent/order/second"]')).toBeVisible()
  })

  test('a pending state holds still', async ({ page }) => {
    await page.goto('/#/Avatar?__state=photo/pending')
    const avatar = page.getByRole('img', { name: 'Maya Chen' })
    await expect(avatar).toHaveText('MC')
    await page.waitForTimeout(1500)
    // Still the initials, and the photo has not been drawn.
    await expect(avatar).toHaveText('MC')
    await expect(avatar.locator('img')).toHaveCSS('opacity', '0')
  })
})
