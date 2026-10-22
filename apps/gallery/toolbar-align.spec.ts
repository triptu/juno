import { expect, test, type Locator, type Page } from '@playwright/test'
import { openState, type Route, type Theme } from './support'

/**
 * Every item in the message hover toolbar and the selection toolbar is
 * centred on the bar: the painted part of each emoji and icon, read from a
 * screenshot, has its centre within half a pixel of the bar's centre line and
 * of its button's centre. The layout boxes alone cannot show this: an emoji
 * set in Figtree's line box drew 1.5px high and 2px left, and a 15px icon in
 * a 24px button drew half a pixel low and right, because the browser puts an
 * SVG's box on whole pixels. The outer insets match, and the rule between the
 * reactions and the icons sits midway between its neighbours.
 */

const open = (page: Page, component: string, id: string, theme: Theme) =>
  openState(page, { component, id, route: `${component}/${id}`, group: '', groupId: '', state: '', frame: {} } satisfies Route, theme)

interface Item {
  readonly name: string
  /** The painted part's centre, from the bar's top left. */
  readonly ink: { readonly x: number; readonly y: number }
  readonly button: { readonly x: number; readonly y: number }
}

/** Reads the painted box inside each button, 3px in from its edges, against the bar's own fill. */
async function measure(page: Page, bar: Locator): Promise<{ readonly height: number; readonly items: ReadonlyArray<Item> }> {
  await expect(bar).toBeVisible()
  // The page around the bar, on whole pixels, so a bar off the pixel grid is measured where it really is.
  const box = (await bar.boundingBox())!
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.x + box.width) - Math.floor(box.x), height: Math.ceil(box.y + box.height) - Math.floor(box.y) }
  const shot = await page.screenshot({ clip, animations: 'disabled' })
  return bar.evaluate(
    async (element, { png, clip }) => {
      const box = element.getBoundingClientRect()
      const buttons = [...element.querySelectorAll('button')].map((button) => {
        const r = button.getBoundingClientRect()
        return { name: button.getAttribute('aria-label') ?? '', x: r.x - box.x, y: r.y - box.y, width: r.width, height: r.height }
      })
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, image.width, image.height).data
      const scale = devicePixelRatio
      // From the bar's top left to the image's pixels.
      const left = (x: number) => Math.round((x + box.x - clip.x) * scale)
      const top = (y: number) => Math.round((y + box.y - clip.y) * scale)
      const at = (x: number, y: number) => {
        const i = (y * image.width + x) * 4
        return [data[i]!, data[i + 1]!, data[i + 2]!] as const
      }
      // The fill just inside the bar's bottom edge, under the first button: no glyph reaches there.
      const fill = at(left(buttons[0]!.x + buttons[0]!.width / 2), top(box.height - 3))
      const painted = (x: number, y: number) => {
        const [r, g, b] = at(x, y)
        return Math.abs(r - fill[0]) + Math.abs(g - fill[1]) + Math.abs(b - fill[2]) > 60
      }
      const items = buttons.map((button) => {
        let inkTop = Infinity
        let inkBottom = -Infinity
        let inkLeft = Infinity
        let inkRight = -Infinity
        for (let y = top(button.y + 3); y < top(button.y + button.height - 3); y++) {
          for (let x = left(button.x + 3); x < left(button.x + button.width - 3); x++) {
            if (!painted(x, y)) continue
            inkTop = Math.min(inkTop, y)
            inkBottom = Math.max(inkBottom, y + 1)
            inkLeft = Math.min(inkLeft, x)
            inkRight = Math.max(inkRight, x + 1)
          }
        }
        return {
          name: button.name,
          ink: { x: (inkLeft + inkRight) / 2 / scale - (box.x - clip.x), y: (inkTop + inkBottom) / 2 / scale - (box.y - clip.y) },
          button: { x: button.x + button.width / 2, y: button.y + button.height / 2 },
        }
      })
      return { height: box.height, items }
    },
    { png: shot.toString('base64'), clip },
  )
}

/** The bar's insets before its first button and after its last, and the gaps either side of the rule. */
const spacing = (bar: Locator) =>
  bar.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const buttons = [...element.querySelectorAll('button')].map((button) => button.getBoundingClientRect())
    const rule = element.querySelector('hr')?.getBoundingClientRect()
    const before = rule === undefined ? undefined : buttons.filter((b) => b.right <= rule.left).at(-1)
    const after = rule === undefined ? undefined : buttons.find((b) => b.left >= rule.right)
    return {
      start: buttons[0]!.left - box.left,
      end: box.right - buttons.at(-1)!.right,
      rule: rule === undefined || before === undefined || after === undefined ? undefined : { before: rule.left - before.right, after: after.left - rule.right },
    }
  })

function expectCentred(found: { readonly height: number; readonly items: ReadonlyArray<Item> }): void {
  expect(found.items.length).toBeGreaterThan(0)
  for (const item of found.items) {
    const detail = JSON.stringify(item)
    expect(Math.abs(item.ink.y - found.height / 2), `${item.name} off the bar's centre line: ${detail}`).toBeLessThan(0.5)
    expect(Math.abs(item.ink.x - item.button.x), `${item.name} off its button's centre: ${detail}`).toBeLessThan(0.5)
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const [component, id] of [
    ['HoverToolbar', 'where/main'],
    ['HoverToolbar', 'reactions/seven'],
    ['MessageList', 'interaction/hover-toolbar-main'],
  ] as const) {
    test(`${component} ${id} (${theme}): every emoji and icon is centred on the bar`, async ({ page }) => {
      await open(page, component, id, theme)
      const frame = page.locator('[data-fixture-frame]')
      if (component === 'MessageList') await frame.locator('[data-message-row]:nth-of-type(5)').hover()
      const bar = frame.getByRole('toolbar').first()
      expectCentred(await measure(page, bar))
      const at = await spacing(bar)
      expect(at.start).toBe(at.end)
      expect(at.rule).toBeDefined()
      expect(at.rule!.before).toBe(at.rule!.after)
    })
  }

  test(`the selection toolbar (${theme}): Quote and Ask Juno are icons centred on the bar`, async ({ page }) => {
    await open(page, 'TopicView', 'interaction/selection-quote', theme)
    const bar = page.getByRole('toolbar', { name: 'Selection' })
    const found = await measure(page, bar)
    expect(found.items.map((item) => item.name)).toEqual(['Quote', 'Ask Juno ⌘J'])
    expectCentred(found)
    const at = await spacing(bar)
    expect(at.start).toBe(at.end)
  })
}
