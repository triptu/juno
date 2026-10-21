import { expect, test, type Page } from '@playwright/test'
import { openState, readRoutes } from './support'

/**
 * Behaviour that a screenshot cannot show, checked against the built gallery
 * in a real browser: the cursor rule and the state switcher. Mouse-down
 * activation is in activation.spec.ts. Layout shift, and the cursor rule on
 * every state, are in shift.spec.ts.
 */

const log = (page: Page) => page.locator('[data-activation-log]')

test('message links use the hand cursor only when they open outside Juno', async ({ page }) => {
  await page.goto('/#/MessageList?__state=thread/long')
  await expect(page.getByRole('link', { name: 'runbook' })).toHaveCSS('cursor', 'pointer')
  await expect(page.locator('[data-channel="C0ENG"]')).toHaveCSS('cursor', 'default')
})

/**
 * A one-line text that is cut off shows its full text as the tooltip when
 * hovered; one that fits shows none. The browser draws the tooltip itself, so
 * the check reads the `title` attribute the hover sets.
 */
/**
 * Home's title lines may be rewritten by the assistant after Home paints
 * (SPEC section 12). The two states hold the same rows with the plain and
 * the rewritten titles: every row, title, meta line, button and the ask
 * field sit in the same boxes in both, so the swap moves nothing.
 */
test('a rewritten Home title line leaves every box where it was', async ({ page }) => {
  const boxes = async (state: string) => {
    await page.goto(`/#/Home?__state=${state}`)
    await expect(page.locator('[data-home-item]')).toHaveCount(3)
    // Boxes measured in a fallback font differ from the web font's. Layout starts the font loads; wait for them.
    await page.evaluate(() => {
      document.body.getBoundingClientRect()
      return document.fonts.ready
    })
    return page.locator('[data-fixture-frame]').evaluate((frame) =>
      Array.from(frame.querySelectorAll('[data-home-item], [data-home-title], [data-home-meta], h2, button')).map((node) => {
        const box = node.getBoundingClientRect()
        return [node.tagName, Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)].join(' ')
      }),
    )
  }
  const plain = await boxes('items/three')
  const rewritten = await boxes('items/ai-titles')
  expect(rewritten).toEqual(plain)
  await expect(page.locator('[data-home-title]').first()).toHaveText("Elena wants a call on Rina's competing offer by Friday")
})

test('a thread link keeps its height when the first reply becomes known', async ({ page }) => {
  await page.goto('/#/ThreadLink?__state=label/not-loaded')
  const link = page.locator('[data-thread-link]')
  await expect(link).toHaveAccessibleName('5 replies')
  await expect(link).toHaveText('5 replies')
  const height = (await link.boundingBox())!.height
  await page.goto('/#/ThreadLink?__state=label/replies')
  await expect(link).toHaveAccessibleName('2 replies: Maya: Sounds good.')
  expect((await link.boundingBox())!.height).toBe(height)
})

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
    await expect(name).toHaveText('Leo Park')
    await expect(name).not.toHaveAttribute('title')
  })

  test('a cut-off thread link preview shows the full preview; one that fits does not', async ({ page }) => {
    await page.goto('/#/ThreadLink?__state=label/long-preview')
    const long = await hoverText(page, /^Priya: Rotate the staging secrets/)
    await expect(long).toHaveAttribute('title', 'Priya: Rotate the staging secrets before the audit, and document where each one lives so nobody has to ask again')
    await page.goto('/#/ThreadLink?__state=label/replies')
    const short = await hoverText(page, 'Maya: Sounds good.')
    await expect(short).not.toHaveAttribute('title')
  })

  test('a cut-off topic header title shows the full title; one that fits does not', async ({ page }) => {
    const title = page.locator('[data-fixture-frame] h1 button span[dir="auto"]')
    await page.goto('/#/TopicHeader?__state=content/long-title')
    await title.hover()
    await expect(title).toHaveAttribute('title', 'Two options for the thread list: compact rows versus two-line previews, and what we lose with each one')
    await page.goto('/#/TopicHeader?__state=thread/public')
    await title.hover()
    await expect(title).toHaveText('Postgres 16 migration plan')
    await expect(title).not.toHaveAttribute('title')
  })

  test('a cut-off topic switcher row title shows the full title; one that fits does not', async ({ page }) => {
    await page.goto('/#/TopicSwitcher?__state=list/long-title')
    const long = await hoverText(page, /^Two options for the thread list/)
    await expect(long).toHaveAttribute('title', 'Two options for the thread list: compact rows versus two-line previews, and what we lose with each one')
    const short = await hoverText(page, 'Pin the Node version in CI')
    await expect(short).not.toHaveAttribute('title')
  })
})

/**
 * A long code block in a message scrolls inside its box, and at its end the
 * wheel goes on to the message list instead of stopping there.
 */
test('the wheel over a long code block reaches the end of the block, then scrolls the message list', async ({ page }) => {
  await page.goto('/#/MessageList?__state=content/long-code')
  const scroller = page.locator('[data-fixture-frame] [data-scroll]')
  await expect(scroller).toBeVisible()
  await scroller.evaluate((node) => {
    node.scrollTop = 0
  })
  const block = page.locator('[data-fixture-frame] pre').first()
  await block.scrollIntoViewIfNeeded()
  const listBefore = await scroller.evaluate((node) => node.scrollTop)
  await block.hover()
  await page.mouse.wheel(0, 5000)
  await expect.poll(() => block.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThan(1)
  // Land exactly on the end (a fraction of a pixel left would take one more notch), and let the
  // wheel gesture end, so the next one starts on a block that cannot scroll and goes on to the list.
  await block.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await page.waitForTimeout(500)
  await page.mouse.wheel(0, 300)
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(listBefore)
})

/**
 * A scroller inside a hover-only list hides its thumb like the list does: a
 * long code block's thumb shows only while the pointer is over the list. The
 * list's hover variable is not inherited, so its rows are not restyled.
 */
test('a code block in the message list shows its thumb only while the pointer is over the list', async ({ page }) => {
  await page.goto('/#/MessageList?__state=content/long-code')
  const block = page.locator('[data-fixture-frame] pre').first()
  await expect(block).toBeVisible()
  expect(await block.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  const list = page.locator('[data-fixture-frame] [data-scroll-area="hover"]')
  const thumb = () => block.evaluate((node) => getComputedStyle(node, '::-webkit-scrollbar-thumb').backgroundColor)
  const transparent = 'rgba(0, 0, 0, 0)'

  const listBox = (await list.boundingBox())!
  await page.mouse.move(0, 0)
  await expect.poll(thumb).toBe(transparent)
  await page.mouse.move(listBox.x + 4, listBox.y + 4)
  await expect.poll(thumb).not.toBe(transparent)
  await block.hover()
  await expect.poll(thumb).not.toBe(transparent)
  expect(await block.evaluate((node) => getComputedStyle(node).getPropertyValue('--scrollbar-thumb'))).toBe('')
  await page.mouse.move(0, 0)
  await expect.poll(thumb).toBe(transparent)
})

/**
 * Message rows are a whole number of pixels tall (performance 3.3). A row
 * laid out for the first time above the view grows from its estimate, and
 * scroll anchoring moves the list by the difference; a fractional difference
 * leaves the rows in view a part of a pixel off, and their text jumps.
 */
test('every message row is a whole number of pixels tall', async ({ page }) => {
  const routes = (await readRoutes(page)).filter((route) => route.component === 'MessageList' || route.component === 'Message')
  expect(routes.length).toBeGreaterThan(0)
  const fractional: string[] = []
  for (const route of routes) {
    await openState(page, route)
    const heights = await page
      .locator('[data-fixture-frame] [data-message-row]')
      .evaluateAll((rows) => rows.map((row) => ({ ts: (row as HTMLElement).dataset['messageRow'] ?? '', height: row.getBoundingClientRect().height })))
    for (const { ts, height } of heights) if (Math.abs(height - Math.round(height)) > 0.001) fractional.push(`${route.route} ${ts}: ${height}px`)
  }
  expect(fractional).toEqual([])
})

// The cursor rule (SPEC section 16) is checked on every state by the shift guard's walk in shift.spec.ts, which opens each state anyway.

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
    // Still the initials, and the photo has no bytes to draw.
    await expect(avatar).toHaveText('MC')
    expect(await avatar.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(0)
  })
})

// Shift and screenshot checks assume the bundled faces on every platform
// (Linux under pnpm remote too), never a system fallback.
test('every font family comes from the bundle', async ({ page }) => {
  await page.goto('/#/Button')
  const families = await page.evaluate(async () => {
    const loaded: Record<string, number> = {}
    for (const family of ['Figtree Variable', 'Instrument Serif', 'JetBrains Mono']) {
      // `load` resolves with the @font-face rules that match; a system font has none.
      loaded[family] = (await document.fonts.load(`16px "${family}"`)).filter((face) => face.status === 'loaded').length
    }
    return loaded
  })
  expect(Object.entries(families).filter(([, faces]) => faces === 0)).toEqual([])
})

test('palette keeps the highlighted item through late commands and reordered results', async ({ page }) => {
  await page.goto('/#/CommandPalette?__state=interaction/updates')
  const palette = page.getByRole('dialog', { name: 'Search and commands' })
  const input = palette.getByRole('combobox')
  await expect(input).toHaveAttribute('aria-activedescendant', 'palette-c1')
  await page.evaluate(() => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.['prepend-command']?.())
  await expect(palette.getByRole('option').first()).toContainText('Send to Maya Chen')
  await expect(input).toHaveAttribute('aria-activedescendant', 'palette-c1')
  await page.evaluate(() => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.['reverse-results']?.())
  await expect(palette.getByRole('option').last()).toContainText('Public channel · Main')
  await input.press('Enter')
  await expect(log(page)).toHaveText('c1')
  await page.evaluate(() => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.['remove-first']?.())
  await expect(page.locator('#palette-c1')).toHaveCount(0)
  await expect(input).not.toHaveAttribute('aria-activedescendant')
  await input.press('Enter')
  await expect(log(page)).toHaveText('c1')
  await input.press('ArrowDown')
  await expect(input).toHaveAttribute('aria-activedescendant', 'palette-cmd')
  await input.press('Enter')
  await expect(log(page)).toHaveText('cmd')
})

/**
 * A fixture that draws the accent swatches checks the gallery's own accent,
 * so a shot in teal never shows coral checked (decision 10-21 17:01). Every
 * state that holds the swatches, in a non-default accent and theme.
 */
test('the checked swatch is the accent the frame is drawn in', async ({ page }) => {
  const routes = (await readRoutes(page)).filter(
    (route) =>
      route.component === 'AppearanceSettings' ||
      route.component === 'SignInView' ||
      (['Shell', 'SettingsPage', 'Sidebar'].includes(route.component) && /appearance|signed-out|account-menu/.test(route.id)),
  )
  expect(routes.length).toBeGreaterThan(10)
  for (const route of routes) {
    await openState(page, route, 'dark', 'teal')
    const frame = page.locator(`[data-fixture-frame="${route.route}"]`)
    const swatches = frame.locator('[role="group"]').filter({ has: page.getByRole('button', { name: 'Coral', exact: true }) })
    if ((await swatches.count()) === 0) continue
    await expect(swatches.getByRole('button', { name: 'Teal', exact: true }), route.route).toHaveAttribute('aria-pressed', 'true')
    await expect(swatches.getByRole('button', { name: 'Coral', exact: true }), route.route).toHaveAttribute('aria-pressed', 'false')
  }
})
