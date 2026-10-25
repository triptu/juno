import { expect, type Page } from '@playwright/test'
import { paintTest as test } from './support'

/**
 * The sidebar row's text levels (SPEC section 5, "Row anatomy"): on a read
 * row the title, then the place and time well below it, and the preview
 * (`--foreground-preview-read`) at or just under them; on an unread row the
 * preview steps up between the title and the meta. Each is at least 4.5:1
 * on what it sits on (the sidebar, a hovered row or the selected row), in
 * both themes and with every accent. In the hover state each row is hovered
 * in turn, read and unread. Colours are resolved by drawing them, so
 * `color-mix()` and variables count as the browser paints them.
 */
const accents = ['coral', 'ink', 'marigold', 'teal', 'midnight', 'emerald', 'claret', 'cyan'] as const
const levels = async (page: Page) =>
  page.locator('[data-fixture-frame]').evaluate((frame) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const rgba = (css: string): [number, number, number, number] => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = css
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      return [r!, g!, b!, a! / 255]
    }
    // The first opaque background at or above the node: rows are transparent until hovered or selected.
    const backdrop = (node: Element): [number, number, number, number] => {
      for (let at: Element | null = node; at !== null; at = at.parentElement) {
        const colour = rgba(getComputedStyle(at).backgroundColor)
        if (colour[3] > 0.99) return colour
      }
      return rgba(getComputedStyle(document.body).backgroundColor)
    }
    const luminance = ([r, g, b]: ReadonlyArray<number>) => {
      const [lr, lg, lb] = [r!, g!, b!].map((c) => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!
    }
    const ratio = (fg: ReadonlyArray<number>, bg: ReadonlyArray<number>) => {
      const [hi, lo] = [luminance(fg), luminance(bg)].toSorted((a, b) => b - a)
      return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100
    }
    return Array.from(frame.querySelectorAll('[data-topic-row]')).map((row) => {
      const part = (name: string) => {
        const node = row.querySelector(`[data-row-part="${name}"]`)
        return node === null ? undefined : ratio(rgba(getComputedStyle(node).color), backdrop(node))
      }
      // A DM's Main has no meta line; its time is the same level.
      const time = part('time')!
      const unread = Number(getComputedStyle(row.querySelector('[data-row-part="title"]')!).fontWeight) >= 600
      return { id: row.getAttribute('data-topic-id'), unread, title: part('title')!, preview: part('preview')!, place: part('place') ?? time, time }
    })
  })


/**
 * The @you chip in a message (tokens.md 1.3, "@you chip"): its text holds
 * 6:1 on its own fill in both themes and with every accent, since the chip
 * is how a mention of you reads at a glance. The fill is opaque, so the
 * chip's own background is what the text sits on.
 */
// One pass per theme: the states are opened in one document, each accent in turn.
for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: sidebar row levels and the @you chip read with every accent`, async ({ page }) => {
    for (const accent of accents) {
      // Each pass is the state and the row to hover, if any.
      const passes: Array<{ state: string; hover?: number }> = [{ state: 'mixed-list' }]
      for (let hover = 0; hover < 3; hover++) passes.push({ state: 'mixed-list-hover', hover })
      for (const { state, hover } of passes) {
        await page.goto(`/#/TopicRow?__state=hierarchy/${state}${theme === 'light' ? '' : '&theme=dark'}${accent === 'coral' ? '' : `&accent=${accent}`}`)
        await expect(page.locator('[data-topic-row]').first()).toBeVisible()
        await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme-switching'))
        if (hover !== undefined) await page.locator('[data-topic-row]').nth(hover).hover()
        const rows = await levels(page)
        expect(rows.length).toBeGreaterThan(2)
        expect(rows.some((row) => row.unread) && rows.some((row) => !row.unread)).toBe(true)
        for (const row of rows) {
          const where = `${row.id} in ${state}${hover === undefined ? '' : `, row ${hover} hovered`}: ${JSON.stringify(row)}`
          expect(row.title, where).toBeGreaterThanOrEqual(7)
          expect(row.preview, where).toBeGreaterThanOrEqual(4.5)
          expect(row.place, where).toBeGreaterThanOrEqual(4.5)
          expect(row.time, where).toBeGreaterThanOrEqual(4.5)
          // A clear step between levels, not just an order.
          if (row.unread) {
            expect(row.title / row.preview, where).toBeGreaterThanOrEqual(1.3)
            expect(row.preview / row.place, where).toBeGreaterThanOrEqual(1.2)
          } else {
            expect(row.title / row.preview, where).toBeGreaterThanOrEqual(2)
            expect(row.preview, where).toBeLessThanOrEqual(row.place)
          }
          expect(row.time, where).toBe(row.place)
        }
      }

      await page.goto(`/#/Message?__state=row/mentions-you${theme === 'light' ? '' : '&theme=dark'}${accent === 'coral' ? '' : `&accent=${accent}`}`)
      const chip = page.locator('[data-fixture-frame] [title="Mentions you"]').first()
      await expect(chip).toBeVisible()
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme-switching'))
      const contrast = await chip.evaluate((node) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d', { willReadFrequently: true })!
        const rgba = (css: string): [number, number, number, number] => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = css
          context.fillRect(0, 0, 1, 1)
          const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
          return [r!, g!, b!, a! / 255]
        }
        const luminance = ([r, g, b]: ReadonlyArray<number>) => {
          const [lr, lg, lb] = [r!, g!, b!].map((c) => {
            const v = c / 255
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
          })
          return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!
        }
        const style = getComputedStyle(node)
        const fill = rgba(style.backgroundColor)
        const [hi, lo] = [luminance(rgba(style.color)), luminance(fill)].toSorted((a, b) => b - a)
        return { opaque: fill[3] > 0.99, ratio: Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100 }
      })
      expect(contrast.opaque, `${theme}, ${accent}`).toBe(true)
      expect(contrast.ratio, `${theme}, ${accent}: ${contrast.ratio}`).toBeGreaterThanOrEqual(6)
    }
  })
}
