import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Reads where icons and emoji are painted, from a screenshot: the layout
 * boxes alone cannot show it. An emoji set in a text font's line box draws
 * high or to one side, and an odd-size icon in an even box draws half a
 * pixel off, because the browser puts an SVG's box on whole pixels.
 */

export interface Item {
  readonly name: string
  /** The painted part's centre, from the bar's top left. */
  readonly ink: { readonly x: number; readonly y: number }
  /** The painted part's edges, from the bar's top left. */
  readonly edges: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
  readonly button: { readonly x: number; readonly y: number }
}

/** Reads the painted box inside each button of `bar`, 3px in from its edges, against the bar's own fill. */
export async function measure(page: Page, bar: Locator): Promise<{ readonly height: number; readonly items: ReadonlyArray<Item> }> {
  await expect(bar).toBeVisible()
  // The page around the bar, on whole pixels, so a bar off the pixel grid is measured where it really is.
  const outer = (await bar.boundingBox())!
  const area = { x: Math.floor(outer.x), y: Math.floor(outer.y), width: Math.ceil(outer.x + outer.width) - Math.floor(outer.x), height: Math.ceil(outer.y + outer.height) - Math.floor(outer.y) }
  const shot = await page.screenshot({ clip: area, animations: 'disabled' })
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
          edges: { left: inkLeft / scale - (box.x - clip.x), right: inkRight / scale - (box.x - clip.x), top: inkTop / scale - (box.y - clip.y), bottom: inkBottom / scale - (box.y - clip.y) },
          button: { x: button.x + button.width / 2, y: button.y + button.height / 2 },
        }
      })
      return { height: box.height, items }
    },
    { png: shot.toString('base64'), clip: area },
  )
}

// Juno ships on macOS, where emoji are Apple Color Emoji. A Linux runner draws them in Noto Color Emoji, which puts the
// emoji in the middle of its advance rather than at its start, so there a text emoji is not checked; images and icons are.
export const textEmoji = (name: string) => process.platform !== 'darwin' && /^React [^:]/.test(name)

export function expectCentred(found: { readonly height: number; readonly items: ReadonlyArray<Item> }): void {
  expect(found.items.length).toBeGreaterThan(0)
  for (const item of found.items.filter((each) => !textEmoji(each.name))) {
    const detail = JSON.stringify(item)
    expect(Math.abs(item.ink.y - found.height / 2), `${item.name} off the bar's centre line: ${detail}`).toBeLessThan(0.5)
    expect(Math.abs(item.ink.x - item.button.x), `${item.name} off its button's centre: ${detail}`).toBeLessThan(0.5)
  }
}

