import { expect, test, type Locator, type Page, type Route as NetworkRoute } from '@playwright/test'
import { expectNoLayoutShift, measureLayoutShift } from '@juno/testing/layout-shift'
import { claimQueue, openState, readRoutes, walkPages, type Route } from './support'

/**
 * Nothing in the product may move when the pointer or the keyboard touches
 * it. For every state, every interactive element is hovered, left, pressed,
 * released, focused from the keyboard and blurred, and none of that may
 * shift the layout (see packages/testing for what counts as a shift).
 *
 * Motion is left on: reduced motion collapses transitions, which would hide
 * a shift that only a real transition produces. The guard waits out only the
 * motion that can move a box (`motion: 'layout'`): every touch starts colour
 * fades and the press scale, which cannot, and waiting for them was most of
 * the run.
 *
 * The same walk checks the cursor rule on each state as it opens it, so the
 * states are opened once for both.
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

const shardMatch = /^(\d+)\/(\d+)$/.exec(process.env.JUNO_SHARD ?? '')
const shard = shardMatch ? { index: Number(shardMatch[1]), total: Number(shardMatch[2]) } : undefined

/** The tests share the states between them so they run in parallel. GALLERY_SHIFT_PARTS sets how many (pnpm remote uses one per worker). */
const shards = Number(process.env.GALLERY_SHIFT_PARTS ?? 12)

async function targets(page: Page, route: Route): Promise<Locator[]> {
  // A disclosure that grows its content in place (Show more) moves what is under it on purpose.
  const all = page.locator(`[data-fixture-frame="${route.route}"]`).locator(interactive).and(page.locator(':not([data-expands-in-place] *)'))
  const count = await all.count()
  const indexes = Array.from({ length: count }, (_, index) => index)
  const picked = count <= perState ? indexes : [...indexes.slice(0, perState - 3), ...indexes.slice(-3)]
  const selected = picked.map((index) => all.nth(index))
  const visible = await Promise.all(selected.map((element) => element.isVisible()))
  return selected.filter((_, index) => visible[index])
}

/** After a touch: code the touch started loading (a popover's content) has rendered, so what it moves is measured too. */
const chunksLoaded = (page: Page) => page.evaluate(() => {
  if (document.querySelector('[data-chunk-pending]') === null) return
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect()
      reject(new Error('Gallery chunks did not load within 15 s'))
    }, 15_000)
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-chunk-pending]') !== null) return
      clearTimeout(timer)
      observer.disconnect()
      resolve()
    })
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true })
  })
})

/** Touches one element every way a person can; returns what shifted, as readable text. */
async function touch(page: Page, element: Locator): Promise<string[]> {
  const failures: string[] = []
  const check = async (what: string, action: () => Promise<unknown>) => {
    try {
      await expectNoLayoutShift(
        page,
        async () => {
          await action()
          await chunksLoaded(page)
        },
        { motion: 'layout' },
      )
    } catch (error) {
      failures.push(`${what}: ${(error as Error).message}`)
    }
  }

  // In one call, and without Playwright's actionability waits: the state is still, and they cost more than a touch.
  const box = await element.evaluate((node) => {
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    return node.getClientRects().length > 0 ? node.getBoundingClientRect().toJSON() as DOMRect : null
  }, undefined, { timeout: 5_000 })
  if (!box) return failures
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await check('hover', () => page.mouse.move(x, y))
  await check('focus from the keyboard', async () => {
    // A key first, so the browser is in keyboard mode and :focus-visible matches.
    await page.keyboard.press('Shift')
    await element.evaluate((node) => (node as HTMLElement).focus(), undefined, { timeout: 5_000 })
  })
  await check('blur', () => element.evaluate((node) => (node as HTMLElement).blur(), undefined, { timeout: 5_000 }))
  await check('press', () => page.mouse.down())
  await check('release', () => page.mouse.up())
  await check('leave', () => page.mouse.move(2, 2))
  return failures
}

/**
 * A hash of what the state drew: the frame, anything portalled beside the
 * gallery's root, scroll positions and the attributes on <html> and <body>
 * (privacy mode is one). Many interaction states exist only
 * for a screenshot (the shot hovers or presses a selector) and draw the very
 * DOM of another state; the guard touches every element itself, so one of
 * them is enough.
 */
const drawn = (page: Page, route: Route) =>
  page.evaluate(async (frameName) => {
    const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)!
    const scrolled = Array.from(frame.querySelectorAll('*'), (node, index) => (node.scrollTop || node.scrollLeft ? `${index}:${node.scrollTop},${node.scrollLeft}` : '')).filter(Boolean)
    const portals = Array.from(document.body.children, (node) => (node.id === 'root' || node.tagName === 'SCRIPT' ? '' : node.outerHTML))
    const attributes = [document.documentElement, document.body].flatMap((node) => node.getAttributeNames().map((name) => `${name}=${node.getAttribute(name)}`))
    const markup = frame.innerHTML
    Object.assign(globalThis, { __junoShiftMarkup: markup })
    const text = [...attributes, frame.className, frame.getAttribute('style'), markup, ...portals, ...scrolled].join('\n')
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }, route.route)

/** Keep the exact markup in the browser: some states have hundreds of KB of DOM. */
const rememberMarkup = (page: Page, route: Route) => page.evaluate((frameName) => {
  Object.assign(globalThis, { __junoShiftMarkup: document.querySelector(`[data-fixture-frame="${frameName}"]`)?.innerHTML ?? '' })
}, route.route)

const markupChanged = (page: Page, route: Route) => page.evaluate((frameName) => {
  const scope: object = globalThis
  return !('__junoShiftMarkup' in scope) || scope.__junoShiftMarkup !== (document.querySelector(`[data-fixture-frame="${frameName}"]`)?.innerHTML ?? '')
}, route.route)

/**
 * SPEC section 16: the arrow cursor everywhere, the text cursor only over
 * editable or selectable text, never the pointer. An element may compute
 * `cursor: text` only when it also computes `user-select: text`, or when it
 * is part of a field (a label wrapping an input), which focuses the input
 * wherever it is clicked. Links that open outside Juno are the one place the
 * hand cursor is allowed.
 */
const cursorOffenders = (page: Page, route: Route) =>
  page.evaluate((frameName) => {
    const frame = document.querySelector(`[data-fixture-frame="${frameName}"]`)
    if (!frame) return ['no frame']
    const bad: string[] = []
    for (const element of Array.from(frame.querySelectorAll('*'))) {
      const style = getComputedStyle(element)
      const describe = () => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[cursor=${style.cursor}]`
      const external = element.closest('a[href^="http:"], a[href^="https:"], a[href^="mailto:"]') !== null
      if (style.cursor === 'pointer' && !external) bad.push(describe())
      const inField = element.closest('label') !== null && element.closest('label')!.querySelector('input, textarea') !== null
      if (style.cursor === 'text' && style.userSelect !== 'text' && !inField) bad.push(describe())
    }
    return bad
  }, route.route)

const only = process.env.GALLERY_SHIFT_ONLY?.split(',').map((name) => name.trim())

async function checkStateWithin(route: Route, check: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${route.route}: state check did not finish within 30 s`)), 30_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

for (let part = 0; part < shards; part++) {
  // The states come from the built gallery, so the list can only be read once a page is open.
  // Over every component the walk is @heavy (scripts/test-areas.mjs); limited with GALLERY_SHIFT_ONLY it is not.
  test(`no interaction shifts the layout, in any state of any component (part ${part + 1} of ${shards})`, { tag: only ? [] : ['@heavy', '@heavy-gallery'] }, async ({ browser }) => {
    // A part walks states until the queue is empty, at up to eight elements and six touches per state.
    // The full walk took 14.3 minutes on three cores; each state still has its own 30 s limit.
    test.setTimeout((only ? 15 : 20) * 60_000)
    const pages = await walkPages(browser)
    // JUNO_SHARD=i/n (pnpm remote --shards n): this machine takes every n-th state.
    const routes = (await readRoutes(pages.page())).filter((route, index) => (!only || only.includes(route.component)) && (!shard || index % shard.total === shard.index))
    const queue = claimQueue('shift')
    const failures: string[] = []
    const cursors: string[] = []
    let states = 0, duplicates = 0, elements = 0, resets = 0
    try {
      for (let route = queue.next(routes); route !== undefined; route = queue.next(routes)) {
        const started = Date.now()
        const page = await pages.next()
        await checkStateWithin(route, async () => {
          await openState(page, route)
          states++
          for (const hit of await cursorOffenders(page, route)) cursors.push(`${route.route}: ${hit}`)
          const shotOnly = route.frame.hover !== undefined || route.frame.press !== undefined || route.frame.focus !== undefined
          if (!queue.claim(`dom ${await drawn(page, route)}`) && shotOnly) {
            duplicates++
            return
          }
          // An interactive fixture can change when touched (a press on Undo puts back other buttons), so the elements
          // after it would be gone or different: open the state again whenever a touch changed what it draws.
          for (const [index, element] of (await targets(page, route)).entries()) {
            if (await markupChanged(page, route)) {
              // The same URL again only changes the hash, which keeps the fixture's state: load a blank page first.
              resets++
              await page.goto('about:blank')
              await openState(page, route)
              await rememberMarkup(page, route)
            }
            elements++
            for (const failure of await touch(page, element)) failures.push(`${route.route} (element ${index + 1}) ${failure}`)
          }
        })
        // A slow state holds up its part; name it so it can be looked at.
        if (Date.now() - started > 10_000) console.log(`slow state: ${route.route} took ${Math.round((Date.now() - started) / 1000)} s`)
      }
    } finally {
      console.log(`shift walk: ${states} states, ${duplicates} screenshot duplicates, ${elements} elements, ${resets} resets`)
      await pages.close()
    }
    expect.soft(cursors, 'no state shows the pointer outside external links, and the text cursor only over selectable text').toEqual([])
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
    await expect.poll(() => avatar.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
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
test.describe('Send', () => {
  const open = (page: Page, component: string, id: string) => openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })

  test('a pending row replaced by the message Slack stored moves nothing', async ({ page }) => {
    await open(page, 'MessageList', 'shift/pending-settles')
    const rows = page.locator('[data-message-row]')
    await expect(page.locator('[data-pending="sending"]')).toHaveCount(1)
    const before = await rows.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))
    await page.evaluate(() => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.['settle']?.())
    await expect(page.locator('[data-pending]')).toHaveCount(0)
    expect(await rows.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))).toEqual(before)
  })
})

/**
 * The checks on send (spec section 8): the audience line and the check bar
 * appear inside the composer, above the text. The composer grows upwards
 * from where it sits; the text row and the field's bottom edge never move.
 */
test.describe('Composer notices', () => {
  const step = (page: Page, name: string) => page.evaluate((control) => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.[control]?.(), name)

  test('the audience line and the check bar come and go without moving the text', async ({ page }) => {
    await openState(page, { component: 'Composer', id: 'shift/notices-come-and-go', route: 'Composer/shift/notices-come-and-go', group: '', groupId: '', state: '', frame: {} })
    const text = page.locator('[data-composer] textarea')
    const field = page.locator('[data-composer-field]')
    const bottom = async () => {
      const box = (await field.boundingBox())!
      return box.y + box.height
    }
    const before = { text: await text.boundingBox(), bottom: await bottom(), height: (await field.boundingBox())!.height }
    for (const notices of ['audience', 'bar', 'both', 'none'] as const) {
      await step(page, notices)
      await expect(page.locator('[data-audience-warning]')).toHaveCount(notices === 'audience' || notices === 'both' ? 1 : 0)
      await expect(page.locator('[data-send-check]')).toHaveCount(notices === 'bar' || notices === 'both' ? 1 : 0)
      expect(await text.boundingBox(), notices).toEqual(before.text)
      expect(await bottom(), notices).toBe(before.bottom)
      if (notices !== 'none') expect((await field.boundingBox())!.height, notices).toBeGreaterThan(before.height)
    }
    expect((await field.boundingBox())!.height).toBe(before.height)
  })

  test('with file chips, the check bar sits above them and the text does not move', async ({ page }) => {
    await openState(page, { component: 'Composer', id: 'shift/notices-over-chips', route: 'Composer/shift/notices-over-chips', group: '', groupId: '', state: '', frame: {} })
    const text = page.locator('[data-composer] textarea')
    const chip = page.getByRole('button', { name: /^Remove / }).first()
    const before = { text: await text.boundingBox(), chip: await chip.boundingBox() }
    for (const notices of ['bar', 'both', 'none'] as const) {
      await step(page, notices)
      await expect(page.locator('[data-send-check]')).toHaveCount(notices === 'none' ? 0 : 1)
      expect(await text.boundingBox(), notices).toEqual(before.text)
      expect(await chip.boundingBox(), notices).toEqual(before.chip)
      if (notices !== 'none') {
        const bar = (await page.locator('[data-send-check]').boundingBox())!
        expect(bar.y + bar.height, notices).toBeLessThanOrEqual(before.chip!.y)
      }
    }
  })
})

/**
 * Changes to one message (spec section 7): a reaction chip joining, its
 * count going up and the chip leaving move nothing; the first chip of a
 * message grows that message at its bottom only; the delete confirm takes
 * the toolbar's place and the edit field the body's without moving any row
 * above. Driven through `window.__fixtureControls`.
 */
test.describe('Message actions', () => {
  const open = (page: Page, component: string, id: string) => openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })
  const step = (page: Page, name: string) => page.evaluate((control) => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.[control]?.(), name)
  const boxes = (page: Page) => page.locator('[data-message-row]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect))

  test('a chip joining, counting up and leaving a row of chips moves nothing', async ({ page }) => {
    await open(page, 'MessageList', 'shift/reaction-changes')
    const before = await boxes(page)
    await step(page, 'chip-joins')
    await expect(page.getByRole('button', { name: '1 👀, including you' })).toHaveCount(1)
    expect(await boxes(page)).toEqual(before)
    await step(page, 'count-up')
    await expect(page.getByRole('button', { name: '2 👀, including you' })).toHaveCount(1)
    expect(await boxes(page)).toEqual(before)
    await step(page, 'chip-leaves')
    await expect(page.getByRole('button', { name: /👀, including you/ })).toHaveCount(0)
    expect(await boxes(page)).toEqual(before)
  })

  // No line is reserved for reactions a message does not have (SPEC 7, "Stable geometry"): the first chip grows its message.
  test('a message’s first chip grows it at its bottom and moves nothing above', async ({ page }) => {
    await open(page, 'MessageList', 'shift/reaction-changes')
    const before = await boxes(page)
    await step(page, 'first-chip')
    await expect(page.getByRole('button', { name: '1 👀, including you' })).toHaveCount(1)
    const after = await boxes(page)
    // Rows 0 and 1 are above the message (row 2): untouched. The message keeps its top; the rows under it move down together.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
    expect(after[2]!.y).toBe(before[2]!.y)
    const grown = after[2]!.height - before[2]!.height
    expect(grown).toBeGreaterThan(0)
    for (let index = 3; index < before.length; index++) expect(after[index]!.y - before[index]!.y).toBe(grown)
  })

  test('the delete confirm takes the toolbar’s place and moves nothing', async ({ page }) => {
    await open(page, 'MessageList', 'shift/own-row-changes')
    const before = await boxes(page)
    await step(page, 'confirm')
    await expect(page.locator('[data-delete-confirm]')).toBeVisible()
    expect(await boxes(page)).toEqual(before)
    await step(page, 'done')
    await expect(page.locator('[data-delete-confirm]')).toHaveCount(0)
    expect(await boxes(page)).toEqual(before)
  })

  test('the edit field takes the body’s place and moves nothing above the message', async ({ page }) => {
    await open(page, 'MessageList', 'shift/own-row-changes')
    const before = await boxes(page)
    await step(page, 'edit')
    await expect(page.getByRole('textbox', { name: 'Edit message' })).toBeFocused()
    const after = await boxes(page)
    const edited = before.length - 1
    expect(after.slice(0, edited)).toEqual(before.slice(0, edited))
    expect(after[edited]!.y).toBe(before[edited]!.y)
    await step(page, 'done')
    expect(await boxes(page)).toEqual(before)
  })

  test('the selection’s toolbar floats over the list, outside the rows, with Quote and Ask Juno', async ({ page }) => {
    await open(page, 'TopicView', 'interaction/selection-quote')
    const toolbar = page.locator('[data-selection-toolbar]')
    await expect(toolbar.locator('[data-selection-quote]')).toBeVisible()
    await expect(toolbar.locator('[data-selection-ask-juno]')).toBeVisible()
    await expect(page.locator('[data-message-row] [data-selection-toolbar]')).toHaveCount(0)
    // Centred over the selection, above it.
    const selection = await page.evaluate(() => window.getSelection()!.getRangeAt(0).getBoundingClientRect().toJSON() as DOMRect)
    const box = (await toolbar.boundingBox())!
    expect(Math.abs(box.x + box.width / 2 - (selection.x + selection.width / 2)), JSON.stringify({ box, selection })).toBeLessThanOrEqual(1)
    expect(box.y + box.height).toBeLessThan(selection.y)
  })
})

for (const injection of ['hover rule', 'loaded chunk'] as const) {
  test(`the broad walk catches an injected shift in a gallery button (${injection})`, async ({ page }) => {
    const route = (await readRoutes(page)).find((route) => route.component === 'Button' && route.id === 'variant/primary')
    expect(route, 'the primary button fixture exists').toBeDefined()
    if (!route) throw new Error('Missing primary button fixture')
    await openState(page, route)
    await page.mouse.move(2, 2)
    if (injection === 'hover rule') {
      await page.addStyleTag({ content: '[data-fixture-frame] button:hover { padding-bottom: 40px !important; }' })
    } else {
      await page.locator('[data-fixture-frame] button').first().evaluate((button) => {
        button.addEventListener('pointerenter', () => {
          const pending = document.createElement('span')
          pending.hidden = true
          pending.setAttribute('data-chunk-pending', '')
          document.body.append(pending)
          setTimeout(() => {
            button.style.paddingBottom = '40px'
            pending.remove()
          }, 100)
        }, { once: true })
      })
    }
    const failures = await touch(page, page.locator('[data-fixture-frame] button').first())
    expect(failures.some((failure) => failure.startsWith('hover: Layout shifted during the action.')), failures.join('\n')).toBe(true)
    expect(failures.join('\n')).toContain('layout box changed')
  })
}

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

  test('counts nested offset parents and reads their positions again after the action', async ({ page }) => {
    await page.setContent(frame(
      '.outer{position:relative;left:20px}.inner{position:relative;left:15px}.child{height:30px}p{margin:0}',
      '<section class="outer"><section class="inner"><div id="child" class="child">Child</div><p id="below">Below</p></section></section>',
    ))
    const report = await measureLayoutShift(page, () => page.evaluate(() => {
      document.querySelector<HTMLElement>('.outer')!.style.left = '31px'
      document.querySelector<HTMLElement>('#child')!.style.height = '39px'
    }))
    const child = report.moved.find((item) => item.element.startsWith('div#child'))!
    const below = report.moved.find((item) => item.element.startsWith('p#below'))!
    expect(child.after.x - child.before.x).toBe(11)
    expect(child.after.height - child.before.height).toBe(9)
    expect(below.after.x - below.before.x).toBe(11)
    expect(below.after.y - below.before.y).toBe(9)
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

  for (const motion of ['all', 'layout'] as const) {
    test(`waits for a transition of a box before it looks (motion: ${motion})`, async ({ page }) => {
      await page.setContent(
        frame('.b{display:block;width:100px;height:30px;transition:height 120ms, color 1s}.b:hover{height:60px;color:red}p{margin:0}', '<button class="b">Slow</button><p>Below</p>'),
      )
      const box = (await page.locator('.b').boundingBox())!
      await expect(expectNoLayoutShift(page, () => page.mouse.move(box.x + 10, box.y + 10), { motion })).rejects.toThrow('dy 30')
    })
  }

  test('with motion: layout, does not wait out a colour fade', async ({ page }) => {
    await page.setContent(frame('.b{display:block;width:100px;height:30px;transition:color 2s}.b:hover{color:red}', '<button class="b">Fade</button>'))
    const box = (await page.locator('.b').boundingBox())!
    const report = await measureLayoutShift(page, () => page.mouse.move(box.x + 10, box.y + 10), { motion: 'layout' })
    expect(report.waitedMs).toBeLessThan(1000)
  })
})

/**
 * The Juno chat (SPEC 13): bubbles arrive whole, reactions land, cards
 * settle, the status bubble comes and goes, and the header's chip changes. None of
 * that may move what the owner is reading. Scenes with a button are also
 * pressed by the generic guard above; a change that is meant to move the
 * list's end (a new last row) is driven through `window.__fixtureControls`
 * instead, and the test checks the rows above it.
 */
test.describe('Juno chat', () => {
  const open = (page: Page, component: string, id: string) => openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })
  const step = (page: Page, name: string) => page.evaluate((control) => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.[control]?.(), name)

  test('a bubble arrives whole above the dots and moves nothing above it', async ({ page }) => {
    await open(page, 'JunoChatList', 'shift/bubble-arrives')
    // The visible bubbles. A bubble that stops being the last of its group gives up the empty slot under it, which shows nothing.
    const rows = [page.locator('[data-chat-owner] p'), page.locator('[data-chat-juno] p').first()]
    const before = await Promise.all(rows.map((row) => row.boundingBox()))
    for (const count of [2, 3]) {
      await step(page, 'bubble')
      await expect(page.locator('[data-chat-juno]')).toHaveCount(count)
      await expect(page.locator('[data-chat-status]')).toHaveCount(1)
      expect(await Promise.all(rows.map((row) => row.boundingBox()))).toEqual(before)
    }
    // The dots stay the last row, under the newest bubble.
    const last = await page.locator('[data-chat-juno]').last().boundingBox()
    expect((await page.locator('[data-chat-status]').boundingBox())!.y).toBeGreaterThan(last!.y)
  })

  test('a reaction lands on its bubble and leaves without moving anything', async ({ page }) => {
    await open(page, 'JunoChatList', 'shift/reaction-arrives')
    const bubbles = page.locator('[data-chat-owner], [data-chat-juno]')
    const before = await bubbles.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))
    await step(page, 'reaction')
    await expect(page.locator('[data-reactions]')).toHaveCount(2)
    expect(await bubbles.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))).toEqual(before)
    await step(page, 'reaction')
    await expect(page.locator('[data-reactions]')).toHaveCount(0)
    expect(await bubbles.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))).toEqual(before)
  })

  test("the status bubble's text changes in place", async ({ page }) => {
    await open(page, 'JunoChatList', 'shift/status-text-changes')
    const status = page.locator('[data-chat-status]')
    const fixed = [page.locator('[data-chat-owner]'), status.locator('i').first()]
    const before = await Promise.all(fixed.map((el) => el.boundingBox()))
    const height = (await status.boundingBox())?.height
    for (let round = 0; round < 3; round++) {
      await step(page, 'status-text')
      await page.waitForTimeout(200)
      expect(await Promise.all(fixed.map((el) => el.boundingBox()))).toEqual(before)
      expect((await status.boundingBox())?.height).toBe(height)
    }
    await expect(status).toContainText('room booking')
  })

  test('turning AI off adds the line at the end and moves no bubble', async ({ page }) => {
    await open(page, 'JunoChatList', 'shift/banner-ai-off')
    const bubbles = page.locator('[data-chat-owner], [data-chat-juno], [data-chat-card]')
    const before = await bubbles.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))
    await step(page, 'ai')
    await expect(page.getByText('Juno is off. Turn on AI assist in Settings.')).toBeVisible()
    expect(await bubbles.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()))).toEqual(before)
  })

  test('a source in a bubble sits in the line like plain words', async ({ page }) => {
    await open(page, 'JunoChatList', 'shift/sources-link')
    // Every bubble's box, the lines of its text and where its last character sits: a source must not change a wrap, a line or a bubble.
    // A range reports a box per nested element too, so lines are counted once each.
    const layout = () =>
      page.locator('[data-chat-owner], [data-chat-juno]').evaluateAll((nodes) =>
        nodes.map((node) => {
          const text = node.querySelector('p')!
          const range = document.createRange()
          range.selectNodeContents(text)
          const lines = [...new Set(Array.from(range.getClientRects(), (rect) => `${rect.y} ${rect.height}`))]
          const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
          let last: Text | undefined
          while (walker.nextNode()) last = walker.currentNode as Text
          const end = document.createRange()
          end.setStart(last!, last!.length - 1)
          end.setEnd(last!, last!.length)
          const { x, y } = end.getBoundingClientRect()
          return { box: node.getBoundingClientRect().toJSON(), lines, end: [x, y] }
        }),
      )
    const plain = await layout()
    await step(page, 'sources')
    await expect(page.locator('[data-source]')).toHaveCount(3)
    expect(await layout()).toEqual(plain)
  })

  for (const [state, settled] of [
    ['resolve-settles', 'Resolved 2'],
    ['send-settles', 'Sent 2'],
    ['send-fails', 'Failed'],
    ['task-state-changes', 'Done'],
    ['question-settles', 'You chose Keep both'],
  ] as const) {
    test(`a ${state.replace(/-/g, ' ')} card keeps its height from the click to the outcome`, async ({ page }) => {
      await open(page, 'ChatCard', `shift/${state}`)
      const card = page.locator('[data-chat-card]')
      const before = await card.boundingBox()
      await expectNoLayoutShift(page, () => page.getByRole('button', { name: 'Next step' }).click())
      expect(await card.boundingBox()).toEqual(before)
      await expectNoLayoutShift(page, async () => {
        await page.getByRole('button', { name: 'Next step' }).click()
        await expect(card).toContainText(settled)
      })
      expect(await card.boundingBox()).toEqual(before)
    })
  }

  test('the banner chip changes without moving the title', async ({ page }) => {
    await open(page, 'JunoHeader', 'shift/banner-cycles')
    const title = page.getByRole('button', { name: 'Juno', exact: true })
    const titleBox = await title.boundingBox()
    const seen = new Set<string>()
    for (let round = 0; round < 7; round++) {
      // The right island is as wide as its chip, so only the left island must hold still.
      await expectRootHolds(page, () => page.getByRole('button', { name: 'Next banner' }).click(), '[data-island="left"]')
      expect(await title.boundingBox()).toEqual(titleBox)
      for (const chip of await page.locator('[data-banner]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-banner')))) {
        if (chip !== null) seen.add(chip)
      }
    }
    expect([...seen].toSorted()).toEqual(['aiOff', 'offline', 'otherDevice', 'paused', 'recovery', 'updateNeeded'])
  })
})

test('the peek floats beside the sidebar: the rows, the tab strip and the page sit where they do without it', async ({ page }) => {
  // The peek fixtures draw the signed-in window of Shell's `signed-in` state with the peek in its slot.
  const boxes = async () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-topic-row], [role="tablist"], main'), (node) => {
        const box = node.getBoundingClientRect()
        return [box.x, box.y, box.width, box.height].map(Math.round).join(' ')
      }),
    )
  await openState(page, { component: 'Shell', id: 'window/signed-in', route: 'Shell/window/signed-in' } as Route)
  const without = await boxes()
  await openState(page, { component: 'PeekView', id: 'size/long', route: 'PeekView/size/long' } as Route)
  const peek = page.locator('[role="dialog"][aria-roledescription="peek"]')
  await expect(peek).toBeVisible()
  expect(without.length).toBeGreaterThan(3)
  expect(await boxes()).toEqual(without)
  // It hangs off the sidebar's right edge and stays inside the window.
  const sidebar = (await page.getByRole('complementary', { name: 'Sidebar' }).boundingBox())!
  const panel = (await peek.boundingBox())!
  const frame = (await page.locator('[data-fixture-frame="PeekView/size/long"]').boundingBox())!
  expect(panel.x).toBeGreaterThan(sidebar.x + sidebar.width)
  expect(panel.x + panel.width).toBeLessThanOrEqual(frame.x + frame.width)
})

/**
 * No element under `root` changed its box. The browser's own `layout-shift`
 * entries are left out on purpose: an island grows with its title or chip,
 * which is the design, and those entries cannot be scoped to a region.
 */
async function expectRootHolds(page: Page, action: () => Promise<unknown>, root: string): Promise<void> {
  const report = await measureLayoutShift(page, action, { root })
  expect(report.moved).toEqual([])
}

/**
 * The topic header floats over the list (SPEC 7, inventory 5): the menu
 * opening, Juno pressed, a rename, resolving and a long title happen in an
 * absolute layer, so none of them may move a message or the scroll position.
 */
test.describe('Topic header', () => {
  const open = (page: Page, component: string, id: string) => openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })

  test('no change in the header moves the list under it', async ({ page }) => {
    await open(page, 'TopicView', 'shift/header-cycles')
    const scroller = page.locator('[data-scroll]')
    const rows = page.locator('[data-message-row]')
    const boxes = () => rows.evaluateAll((nodes) => nodes.slice(0, 12).map((node) => node.getBoundingClientRect().toJSON()))
    const before = { scrollTop: await scroller.evaluate((node) => node.scrollTop), rows: await boxes() }
    expect(before.scrollTop).toBeGreaterThan(0)
    const titles = new Set<string>()
    for (let round = 0; round < 6; round++) {
      // The islands are as wide as their content; the list under them must not move.
      await expectRootHolds(page, () => page.getByRole('button', { name: 'Next header' }).click(), '[data-scroll]')
      expect(await scroller.evaluate((node) => node.scrollTop)).toBe(before.scrollTop)
      expect(await boxes()).toEqual(before.rows)
      titles.add((await page.locator('[data-topic-header] h1').textContent()) ?? '')
    }
    expect(titles.size).toBeGreaterThan(2)
  })

  test('the list starts below the band at the top, and its scrollbar track starts below the band', async ({ page }) => {
    await open(page, 'TopicView', 'header/thread-at-top')
    const scroller = page.locator('[data-scroll]')
    const geometry = await scroller.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const band = document.querySelector('[data-header-band]')!.getBoundingClientRect()
      const first = node.querySelector('[data-message-row]')!.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        bandTop: band.top - box.top,
        bandHeight: band.height,
        firstRow: first.top - box.top,
        scrollPadding: style.scrollPaddingTop,
        trackMargin: getComputedStyle(node, '::-webkit-scrollbar-track').marginTop,
      }
    })
    expect(geometry.bandTop).toBe(0)
    expect(geometry.bandHeight).toBe(68)
    expect(geometry.firstRow).toBeGreaterThanOrEqual(68)
    expect(geometry.scrollPadding).toBe('68px')
    expect(geometry.trackMargin).toBe('68px')
  })

  test('the islands line up with the composer, and the band lets the pointer through', async ({ page }) => {
    await open(page, 'TopicView', 'header/thread-scrolled')
    const left = (await page.locator('[data-island="left"]').boundingBox())!
    const right = (await page.locator('[data-island="right"]').boundingBox())!
    const composer = (await page.locator('[data-composer-slot] > *').first().boundingBox())!
    // The reading column's 24px padding puts the islands' outer edges on the composer's.
    expect(Math.round(left.x)).toBe(Math.round(composer.x))
    expect(Math.round(right.x + right.width)).toBe(Math.round(composer.x + composer.width))
    expect(Math.round(left.y)).toBe(Math.round((await page.locator('[data-topic-view]').boundingBox())!.y + 8))
    const under = await page.evaluate(() => {
      const band = document.querySelector('[data-header-band]')!.getBoundingClientRect()
      const hit = document.elementFromPoint(band.left + 4, band.bottom - 4)
      return hit?.closest('[data-header-band]') === null
    })
    expect(under).toBe(true)
  })

  test('Resolve is a 28px icon at every width, named and with its word as the tooltip, and ⋯ is the same size', async ({ page }) => {
    for (const state of ['narrow/thread-336', 'narrow/thread-480', 'thread/public']) {
      await open(page, 'TopicHeader', state)
      const resolve = page.getByRole('button', { name: 'Resolve', exact: true })
      await expect(resolve).toBeVisible()
      await expect(resolve).toHaveText('', { useInnerText: true })
      await expect(resolve).toHaveAttribute('data-tooltip', 'Resolve')
      expect(Math.round((await resolve.boundingBox())!.width)).toBe(28)
    }
    await open(page, 'TopicHeader', 'narrow/main-336')
    const more = page.getByRole('button', { name: 'More', exact: true })
    await expect(more).toBeVisible()
    expect(Math.round((await more.boundingBox())!.width)).toBe(28)
  })
})

/** Following a thread from its header swaps Follow for Resolve, which must move nothing (SPEC 7). */
test.describe('Topic header Follow', () => {
  const open = (page: Page, component: string, id: string) => openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })

  test('Follow and Resolve are one width, roomy and narrow, so following moves nothing', async ({ page }) => {
    const box = async (state: string, name: string) => {
      await open(page, 'TopicHeader', state)
      const button = page.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      return (await button.boundingBox())!
    }
    for (const [follow, followed] of [
      ['follow/follow', 'follow/followed'],
      ['follow/follow-336', 'follow/followed-336'],
    ] as const) {
      const before = await box(follow, 'Follow')
      const after = await box(followed, 'Resolve')
      expect(after.x).toBeCloseTo(before.x, 1)
      expect(after.width).toBeCloseTo(before.width, 1)
    }
    await open(page, 'TopicHeader', 'follow/follow')
    await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('data-tooltip', 'Follow')
  })
})

/**
 * Attachments (SPEC section 8): a chip leaving the composer, the upload line
 * under a sending message and a card's Download button move nothing.
 */
test.describe('Attachments', () => {
  const open = (page: Page, component: string, id: string) => openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} })
  const step = (page: Page, name: string) => page.evaluate((control) => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.[control]?.(), name)
  const boxes = (locator: Locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect))

  test('removing a chip leaves the text row and the field where they were', async ({ page }) => {
    await open(page, 'Composer', 'attachments/chip-removal')
    const fixed = page.locator('[data-composer] textarea, [data-composer-field]')
    const before = await boxes(fixed)
    await step(page, 'remove')
    await expect(page.locator('[data-attachment]')).toHaveCount(2)
    expect(await boxes(fixed)).toEqual(before)
    await step(page, 'remove')
    await expect(page.locator('[data-attachment]')).toHaveCount(1)
    expect(await boxes(fixed)).toEqual(before)
  })

  test('the upload line appearing, moving and going changes no row', async ({ page }) => {
    await open(page, 'MessageList', 'shift/upload-progress')
    const rows = page.locator('[data-message-row]')
    const before = await boxes(rows)
    await step(page, 'start')
    await expect(page.getByRole('progressbar', { name: 'Uploading' })).toHaveAttribute('aria-valuenow', '20')
    expect(await boxes(rows)).toEqual(before)
    await step(page, 'advance')
    await expect(page.getByRole('progressbar', { name: 'Uploading' })).toHaveAttribute('aria-valuenow', '80')
    expect(await boxes(rows)).toEqual(before)
    await step(page, 'done')
    await expect(page.getByRole('progressbar')).toHaveCount(0)
    expect(await boxes(rows)).toEqual(before)
  })

  test('a card’s Download button changes neither the card nor the rows', async ({ page }) => {
    await open(page, 'MessageList', 'shift/download-appears')
    const cards = page.locator('[data-file-card]')
    const rows = page.locator('[data-message-row]')
    const before = { cards: await boxes(cards), rows: await boxes(rows) }
    await step(page, 'download')
    await expect(page.getByRole('button', { name: /^Download / })).toHaveCount(2)
    expect({ cards: await boxes(cards), rows: await boxes(rows) }).toEqual(before)
  })
})
