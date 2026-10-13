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
  const stateParam = (page: Page) => new URL(page.url().replace('#/', '')).searchParams.get('__state')
  const componentOf = (page: Page) => page.url().split('#/')[1]?.split('?')[0]

  test('lists a component\'s states under their group headings and marks the open one', async ({ page }) => {
    await page.goto('/#/SignInView?__state=failure/keychain')
    const panel = page.getByRole('navigation', { name: 'Gallery switcher' })
    await expect(panel.getByRole('heading', { name: 'Session' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Progress' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Failure' })).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Keychain' })).toHaveAttribute('aria-current', 'true')
    await expect(panel.getByRole('link', { name: 'Expired' })).not.toHaveAttribute('aria-current', 'true')
    await expect(page.locator('[data-fixture-frame]')).toHaveAttribute('data-fixture-frame', 'SignInView/failure/keychain')
    await expect(page.getByText(/Allow access when macOS asks/)).toBeVisible()
  })

  test('shows only the chosen state, and a state link keeps the theme and accent', async ({ page }) => {
    await page.goto('/#/SignInView?__state=session/expired&theme=dark&accent=claret')
    const panel = page.getByRole('navigation', { name: 'Gallery switcher' })
    await expect(page.locator('[data-fixture-frame]')).toHaveCount(1)
    await panel.getByRole('link', { name: 'Offline' }).click()
    await expect(page.locator('[data-fixture-frame="SignInView/failure/offline"]')).toBeVisible()
    expect(page.url()).toContain('__state=failure/offline')
    expect(page.url()).toContain('theme=dark')
    expect(page.url()).toContain('accent=claret')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('opens the first state when none is named, and still understands a bare state key', async ({ page }) => {
    await page.goto('/#/AppInfoView')
    await expect(page.locator('[data-fixture-frame="AppInfoView/data/default"]')).toBeVisible()
    await page.goto('/#/AppInfoView/loading')
    await expect(page.locator('[data-fixture-frame="AppInfoView/data/loading"]')).toBeVisible()
  })

  test('j and k, and the arrow keys, move between states and stop at the ends', async ({ page }) => {
    await page.goto('/#/AppInfoView?__state=data/default')
    await expect(page.locator('[data-fixture-frame]')).toBeVisible()
    await page.keyboard.press('j')
    await expect.poll(() => stateParam(page)).toBe('data/loading')
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => stateParam(page)).toBe('data/failed')
    // The walk crosses into the next group and stops at the component's last state.
    await page.keyboard.press('j')
    await expect.poll(() => stateParam(page)).toBe('diagnostics/compact')
    await page.keyboard.press('j')
    await expect.poll(() => stateParam(page)).toBe('diagnostics/compact')
    await page.keyboard.press('k')
    await expect.poll(() => stateParam(page)).toBe('data/failed')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => stateParam(page)).toBe('data/default')
  })

  test('[ and ] switch components, wrapping around', async ({ page }) => {
    const names = [...new Set((await readRoutes(page)).map((route) => route.component))]
    const first = names[0]!
    const last = names.at(-1)!
    await page.goto(`/#/${first}?theme=dark`)
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
    await page.goto('/#/TextField?__state=value/search')
    await page.getByRole('searchbox').or(page.getByRole('textbox')).first().focus()
    await page.keyboard.type('jk[]')
    expect(stateParam(page)).toBe('value/search')
    await expect(page.getByRole('searchbox').or(page.getByRole('textbox')).first()).toHaveValue('jk[]')
  })

  test('leaves the arrow keys to the component under test', async ({ page }) => {
    await page.goto('/#/Slider?__state=value/default')
    await page.getByRole('slider').focus()
    await page.keyboard.press('ArrowDown')
    expect(stateParam(page)).toBe('value/default')
  })

  test('a narrow window swaps the list for a select above the frame', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 })
    await page.goto('/#/SignInView?__state=session/first-run')
    await expect(page.getByRole('navigation', { name: 'Gallery switcher' })).toBeHidden()
    const select = page.getByRole('combobox', { name: 'State' })
    await expect(select).toBeVisible()
    await select.selectOption('progress/importing')
    await expect(page.locator('[data-fixture-frame="SignInView/progress/importing"]')).toBeVisible()
    expect(stateParam(page)).toBe('progress/importing')
  })

  test('the index lists every component with its state groups', async ({ page }) => {
    await page.goto('/#/')
    const appInfo = page.locator('.g-component', { hasText: 'AppInfoView' }).first()
    await expect(appInfo.locator('.g-group-line')).toHaveText(['Data: default, loading, failed', 'Diagnostics: compact'])
    await appInfo.getByRole('link', { name: 'loading' }).click()
    await expect(page.locator('[data-fixture-frame="AppInfoView/data/loading"]')).toBeVisible()
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
