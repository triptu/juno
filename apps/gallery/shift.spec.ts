import { expect, test, type Locator, type Page, type Route as NetworkRoute } from '@playwright/test'
import { expectNoLayoutShift } from '@juno/testing/layout-shift'
import { openState, readRoutes, type Route } from './support'

/**
 * Nothing in the product may move when the pointer or the keyboard touches
 * it. For every state, every interactive element is hovered, left, pressed,
 * released, focused from the keyboard and blurred, and none of that may
 * shift the layout (see packages/testing for what counts as a shift).
 *
 * Motion is left on: reduced motion collapses transitions, which would hide
 * a shift that only a real transition produces.
 *
 * To look at one component: GALLERY_SHIFT_ONLY=Button,Chip pnpm test:gallery
 */
test.use({ reducedMotion: 'no-preference' })

/** What a person can point at or tab to, plus scroll areas. Disabled controls cannot be pointed at. */
const interactive = [
  'button:not(:disabled)',
  'a[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[role="button"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="switch"]',
  '[role="slider"]',
  '[tabindex]:not([tabindex="-1"])',
  // Scroll areas show their thumb on hover; the gutter must not change.
  '[data-scroll-area]',
].join(', ')

/** Elements tried per state. A state with more (an icon grid) is sampled from both ends. */
const perState = 8

/** The tests split the components between them so they run in parallel. */
const shards = 6

/** Deals components out, biggest first, to whichever part has the fewest states so far. */
function partsOf(routes: ReadonlyArray<Route>): string[][] {
  const sizes = new Map<string, number>()
  for (const route of routes) sizes.set(route.component, (sizes.get(route.component) ?? 0) + 1)
  const parts = Array.from({ length: shards }, () => ({ load: 0, components: [] as string[] }))
  for (const [component, size] of [...sizes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const lightest = parts.reduce((least, part) => (part.load < least.load ? part : least))
    lightest.load += size
    lightest.components.push(component)
  }
  return parts.map((part) => part.components)
}

async function targets(page: Page, route: Route): Promise<Locator[]> {
  const all = page.locator(`[data-fixture-frame="${route.route}"]`).locator(interactive)
  const count = await all.count()
  const indexes = Array.from({ length: count }, (_, index) => index)
  const picked = count <= perState ? indexes : [...indexes.slice(0, perState - 3), ...indexes.slice(-3)]
  const found: Locator[] = []
  for (const index of picked) {
    const element = all.nth(index)
    if (await element.isVisible()) found.push(element)
  }
  return found
}

/** Touches one element every way a person can; returns what shifted, as readable text. */
async function touch(page: Page, element: Locator): Promise<string[]> {
  const failures: string[] = []
  const check = async (what: string, action: () => Promise<unknown>) => {
    try {
      await expectNoLayoutShift(page, action)
    } catch (error) {
      failures.push(`${what}: ${(error as Error).message}`)
    }
  }

  await element.scrollIntoViewIfNeeded()
  const box = await element.boundingBox()
  if (!box) return failures
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await check('hover', () => page.mouse.move(x, y))
  await check('press', () => page.mouse.down())
  await check('release', () => page.mouse.up())
  await check('leave', () => page.mouse.move(2, 2))
  await check('focus from the keyboard', async () => {
    // A key first, so the browser is in keyboard mode and :focus-visible matches.
    await page.keyboard.press('Shift')
    await element.evaluate((node) => (node as HTMLElement).focus())
  })
  await check('blur', () => element.evaluate((node) => (node as HTMLElement).blur()))
  return failures
}

const only = process.env.GALLERY_SHIFT_ONLY?.split(',').map((name) => name.trim())

for (let shard = 0; shard < shards; shard++) {
  // The states come from the built gallery, so the list can only be read once
  // a page is open; each component is a step so the report groups by component.
  test(`no interaction shifts the layout, in any state of any component (part ${shard + 1} of ${shards})`, async ({ page }) => {
    test.setTimeout(10 * 60_000)
    const routes = await readRoutes(page)
    const components = partsOf(routes)[shard] ?? []
    const failures: string[] = []
    for (const component of components) {
      if (only && !only.includes(component)) continue
      await test.step(component, async () => {
        for (const route of routes.filter((candidate) => candidate.component === component)) {
          await openState(page, route)
          for (const [index, element] of (await targets(page, route)).entries()) {
            for (const failure of await touch(page, element)) failures.push(`${route.route} (element ${index + 1}) ${failure}`)
          }
        }
      })
    }
    expect(failures.join('\n\n')).toBe('')
  })
}

/** Holds the Avatar photo request until the returned function is called, then answers it. */
async function holdPhoto(page: Page, answer: (route: NetworkRoute) => Promise<void>): Promise<() => void> {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/__fixture/pending.png', async (route) => {
    await gate
    await answer(route)
  })
  return release
}

test.describe('Avatar photo', () => {
  const photo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#8EB5C9"/></svg>`
  const arrive = (route: NetworkRoute) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: photo })

  test('arriving late does not move anything', async ({ page }) => {
    const release = await holdPhoto(page, arrive)
    await page.goto('/#/Avatar?__state=photo/pending')
    const avatar = page.getByRole('img', { name: 'Maya Chen' })
    await expect(avatar).toHaveText('MC')
    const image = avatar.locator('img')
    await expect(image).toHaveCSS('opacity', '0')

    await expectNoLayoutShift(page, async () => {
      release()
      // The photo is drawn: its fade-in has started, the box is the same.
      await expect(image).not.toHaveCSS('opacity', '0')
    })
    await expect(image).toHaveCSS('opacity', '1')
  })

  test('failing to arrive does not move anything', async ({ page }) => {
    const release = await holdPhoto(page, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' }))
    await page.goto('/#/Avatar?__state=photo/pending')
    const avatar = page.getByRole('img', { name: 'Maya Chen' })
    await expect(avatar.locator('img')).toHaveCount(1)
    await expectNoLayoutShift(page, async () => {
      release()
      // The photo failed: the image is gone and the initials stayed.
      await expect(avatar.locator('img')).toHaveCount(0)
    })
    await expect(avatar).toHaveText('MC')
  })

  test('the box is its final size before the photo arrives', async ({ page }) => {
    const release = await holdPhoto(page, arrive)
    await page.goto('/#/Avatar?__state=photo/pending')
    const avatar = page.getByRole('img', { name: 'Maya Chen' })
    const before = await avatar.boundingBox()
    release()
    await expect(avatar.locator('img')).toHaveCSS('opacity', '1')
    expect(await avatar.boundingBox()).toEqual(before)
  })
})

test.describe('Message thumbnail', () => {
  const picture = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#8EB5C9"/></svg>`
  const arrive = (route: NetworkRoute) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: picture })

  test('arriving late does not move anything', async ({ page }) => {
    const release = await holdPhoto(page, arrive)
    await page.goto('/#/MessageList?__state=files/thumbnail-pending')
    const thumb = page.getByRole('img', { name: 'staging-screenshot.png' })
    const image = thumb.locator('img')
    await expect(image).toHaveCSS('opacity', '0')
    const before = await thumb.boundingBox()

    await expectNoLayoutShift(page, async () => {
      release()
      await expect(image).not.toHaveCSS('opacity', '0')
    })
    await expect(image).toHaveCSS('opacity', '1')
    // The box was its final size before the bytes came.
    expect(await thumb.boundingBox()).toEqual(before)
  })

  test('failing to arrive does not move anything', async ({ page }) => {
    const release = await holdPhoto(page, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' }))
    await page.goto('/#/MessageList?__state=files/thumbnail-pending')
    const thumb = page.getByRole('img', { name: 'staging-screenshot.png' })
    await expect(thumb.locator('img')).toHaveCount(1)
    const before = await thumb.boundingBox()
    await expectNoLayoutShift(page, async () => {
      release()
      await expect(thumb.locator('img')).toHaveCount(0)
    })
    expect(await thumb.boundingBox()).toEqual(before)
  })
})

test.describe('Topic art', () => {
  for (const [state, size] of [
    ['arrival', 40],
    ['arrival-header', 20],
    ['arrival-tab', 16],
  ] as const) {
    test(`art arriving over the placeholder at ${size}px moves nothing`, async ({ page }) => {
      await page.goto(`/#/TopicArt?__state=swap/${state}`)
      const tile = page.locator('[data-topic-art]')
      await expect(tile).toHaveAttribute('data-topic-art', 'placeholder')
      const before = await tile.boundingBox()
      expect(before?.width).toBe(size)
      expect(before?.height).toBe(size)
      await expectNoLayoutShift(page, async () => {
        await page.getByRole('button', { name: 'Art arrives' }).click()
        await expect(tile).toHaveAttribute('data-topic-art', 'art')
      })
      // The art is drawn over the pebble; both layers kept the box.
      await expect(tile.locator('svg')).toHaveCount(2)
      await expect(tile.locator('span').nth(1)).toHaveCSS('opacity', '1')
      await expect(tile.locator('span').nth(0)).toHaveCSS('opacity', '0')
      expect(await tile.boundingBox()).toEqual(before)
    })
  }
})

/**
 * The guard has to fail when something moves, or a green run means nothing.
 * These pages are made on the spot, so they do not depend on any component.
 */
test.describe('the guard itself', () => {
  const frame = (css: string, body: string) => `<style>${css}</style><div data-fixture-frame="guard">${body}</div>`

  test('fails when hovering grows an element and pushes the next one down', async ({ page }) => {
    await page.setContent(
      frame('.b{display:block;width:100px;height:30px;font:12px sans-serif}.b:hover{height:60px}p{margin:0}', '<button class="b">Hover me</button><p>Below</p>'),
    )
    // Paint the initial layout before asking the browser to score a shift.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const box = (await page.locator('.b').boundingBox())!
    const error = await expectNoLayoutShift(page, async () => {
      // A keypress sets hadRecentInput; hovering alone does not.
      await page.keyboard.press('a')
      await page.mouse.move(box.x + 10, box.y + 10)
    }).then(
      () => null,
      (reason: Error) => reason,
    )
    expect(error?.message).toContain('Layout shifted during the action.')
    // The browser's score counts it even though it came right after input.
    expect(error?.message).toMatch(/layout-shift value [\d.]+ at \+\d+ms \(hadRecentInput, counted anyway\)/)
    expect(error?.message).toContain('layout box changed')
    expect(error?.message).toContain('Below')
    expect(error?.message).toContain('dy 30')
  })

  test('lets a press scale, a colour change and a focus ring through', async ({ page }) => {
    await page.setContent(
      frame(
        '.b{display:block;width:100px;height:30px;transition:transform 150ms, background-color 150ms}.b:active{transform:scale(0.96)}.b:hover{background:#ccc}.b:focus-visible{outline:2px solid blue;outline-offset:2px}p{margin:0}',
        '<button class="b">Press me</button><p>Below</p>',
      ),
    )
    const box = (await page.locator('.b').boundingBox())!
    await expectNoLayoutShift(page, () => page.mouse.move(box.x + 10, box.y + 10))
    await expectNoLayoutShift(page, () => page.mouse.down())
    await expectNoLayoutShift(page, () => page.mouse.up())
    await expectNoLayoutShift(page, async () => {
      await page.keyboard.press('Shift')
      await page.locator('.b').focus()
    })
  })

  test('waits for a transition before it looks', async ({ page }) => {
    await page.setContent(
      frame('.b{display:block;width:100px;height:30px;transition:height 120ms}.b:hover{height:60px}p{margin:0}', '<button class="b">Slow</button><p>Below</p>'),
    )
    const box = (await page.locator('.b').boundingBox())!
    await expect(expectNoLayoutShift(page, () => page.mouse.move(box.x + 10, box.y + 10))).rejects.toThrow('dy 30')
  })
})
