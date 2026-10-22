import { expect, type Locator, type Page } from '@playwright/test'

/** A painted area, in CSS pixels from the measured element's top left. */
export interface Ink {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly x: number
  readonly y: number
}

export interface InkReading {
  readonly width: number
  readonly height: number
  /** One per part, in the order given; undefined when nothing in the part's area differs from the fill. */
  readonly parts: ReadonlyArray<Ink | undefined>
}

/**
 * Reads, from a screenshot, the painted part of each child of `element`
 * that matches `parts` (in document order). A part's area is its own box
 * across, clipped to the element, and the element's height less `inset`
 * down, so ink that a line box does not hold is still found; with `spill`,
 * only the part's own box and that much above and below it. A pixel is
 * painted when it differs from the fill at `fillAt` (CSS pixels from the
 * element's top left) by more than 60 over the three channels.
 */
export async function readInk(
  page: Page,
  element: Locator,
  { parts, fillAt, inset = 2, spill = Infinity }: { readonly parts: string; readonly fillAt: { readonly x: number; readonly y: number }; readonly inset?: number; readonly spill?: number },
): Promise<InkReading> {
  await expect(element).toBeVisible()
  // The page around the element, on whole pixels, so an element off the pixel grid is measured where it really is.
  const outer = (await element.boundingBox())!
  const area = { x: Math.floor(outer.x), y: Math.floor(outer.y), width: Math.ceil(outer.x + outer.width) - Math.floor(outer.x), height: Math.ceil(outer.y + outer.height) - Math.floor(outer.y) }
  const shot = await page.screenshot({ clip: area, animations: 'disabled' })
  return element.evaluate(
    async (node, { png, clip, parts, fillAt, inset, spill }) => {
      const box = node.getBoundingClientRect()
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob())
      const canvas = new OffscreenCanvas(image.width, image.height)
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, image.width, image.height).data
      const scale = devicePixelRatio
      const left = (x: number) => Math.round((x + box.x - clip.x) * scale)
      const top = (y: number) => Math.round((y + box.y - clip.y) * scale)
      const at = (x: number, y: number) => {
        const i = (y * image.width + x) * 4
        return [data[i]!, data[i + 1]!, data[i + 2]!] as const
      }
      const fill = at(left(fillAt.x), top(fillAt.y))
      const painted = (x: number, y: number) => {
        const [r, g, b] = at(x, y)
        return Math.abs(r - fill[0]) + Math.abs(g - fill[1]) + Math.abs(b - fill[2]) > 60
      }
      const read = (part: Element) => {
        const r = part.getBoundingClientRect()
        const from = Math.max(r.left, box.left + inset) - box.left
        const to = Math.min(r.right, box.right - inset) - box.left
        const over = Math.max(r.top - spill, box.top + inset) - box.top
        const under = Math.min(r.bottom + spill, box.bottom - inset) - box.top
        let inkTop = Infinity
        let inkBottom = -Infinity
        let inkLeft = Infinity
        let inkRight = -Infinity
        for (let y = top(over); y < top(under); y++) {
          for (let x = left(from); x < left(to); x++) {
            if (!painted(x, y)) continue
            inkTop = Math.min(inkTop, y)
            inkBottom = Math.max(inkBottom, y + 1)
            inkLeft = Math.min(inkLeft, x)
            inkRight = Math.max(inkRight, x + 1)
          }
        }
        if (inkTop === Infinity) return undefined
        const ink = { top: inkTop / scale - (box.y - clip.y), bottom: inkBottom / scale - (box.y - clip.y), left: inkLeft / scale - (box.x - clip.x), right: inkRight / scale - (box.x - clip.x) }
        return { ...ink, x: (ink.left + ink.right) / 2, y: (ink.top + ink.bottom) / 2 }
      }
      const found = parts === ':scope' ? [node] : [...node.querySelectorAll(parts)]
      return { width: box.width, height: box.height, parts: found.map(read) }
    },
    { png: shot.toString('base64'), clip: area, parts, fillAt, inset, spill },
  )
}
