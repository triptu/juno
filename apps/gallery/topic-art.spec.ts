import { expect, type Page } from '@playwright/test'
import { test } from './support'

/**
 * Topic art arriving, checked frame by frame in a real browser: on screen it
 * fades the placeholder out, off screen it is whole by the time the row
 * renders. That the swap moves nothing is in shift.spec.ts.
 */
test.describe('topic art', () => {
  /** Scrolls the pebble layer's row into view and reads the layer in the second frame after: the first frame drawn with the row. */
  const firstFrame = (page: Page, selector: string) =>
    page.evaluate(
      (selector) =>
        new Promise<{ opacity: string; animations: number }>((resolve) => {
          const pebble = document.querySelector(selector)!
          pebble.closest('[data-topic-row]')!.scrollIntoView({ block: 'center' })
          requestAnimationFrame(() => requestAnimationFrame(() => resolve({ opacity: getComputedStyle(pebble).opacity, animations: pebble.getAnimations().length })))
        }),
      selector,
    )

  // Reduced motion matters too: global.css gives every element a 0.01 ms transition then, which also starts only when the row renders.
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test.describe(`with reduced motion ${reducedMotion}`, () => {
      test.use({ reducedMotion })

      test('art that arrived while its row was off screen shows whole on the row’s first frame', async ({ page }) => {
        await page.goto('/#/Sidebar?__state=art/off-screen')
        const id = 'C0ENG:1760000000.000100:2'
        const tile = page.locator(`[data-topic-id="${id}"] [data-topic-art]`)
        await expect(tile).toHaveAttribute('data-topic-art', 'placeholder')
        // Far enough below that `content-visibility` skips the row's contents.
        expect(await tile.evaluate((node) => node.checkVisibility({ contentVisibilityAuto: true }))).toBe(false)
        await page.evaluate(() => (window as unknown as { __fixtureControls?: Record<string, () => void> }).__fixtureControls?.['art']?.())
        await expect(tile).toHaveAttribute('data-topic-art', 'art')
        // Longer than the 240 ms fade.
        await page.waitForTimeout(500)
        expect(await firstFrame(page, `[data-topic-id="${id}"] [data-topic-art] > span:first-child`)).toEqual({ opacity: '0', animations: 0 })
      })
    })
  }

  test.describe('with motion', () => {
    test.use({ reducedMotion: 'no-preference' })

    test('art that arrives on screen fades the placeholder out', async ({ page }) => {
      await page.goto('/#/TopicArt?__state=swap/arrival')
      await expect(page.locator('[data-topic-art]')).toHaveAttribute('data-topic-art', 'placeholder')
      // Read as soon as the art is in the page, so a slow machine cannot finish the fade first.
      const fades = await page.evaluate(
        () =>
          new Promise<ReadonlyArray<unknown>>((resolve) => {
            const tile = document.querySelector('[data-topic-art]')!
            const pebble = tile.firstElementChild!
            new MutationObserver(() => resolve(pebble.getAnimations().map((animation) => animation.effect?.getComputedTiming().duration))).observe(tile, { attributes: true })
            const arrives = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Art arrives')!
            arrives.click()
          }),
      )
      expect(fades).toEqual([240])
    })
  })
})
