import { expect, test } from '@playwright/test'
import { openState } from './support'

/**
 * Home's writing stack (SPEC section 12, "Writing"): the destination chip
 * sits on the field's left edge, just above it, so it labels the field.
 */
test.describe('Home writing geometry', () => {
  // In light only: the dark theme changes colours and shadows, never a size (packages/tokens/src/themes.stylex.ts).
  for (const state of ['juno', 'maya-chosen', 'multiline'] as const) {
    test(`${state}: the chip sits on the field's edge, just above it`, async ({ page }) => {
      const id = `write/${state}`
      await openState(page, { component: 'Home', id, route: `Home/${id}`, group: '', groupId: '', state, frame: {} })
      const at = await page.evaluate(() => {
        const field = document.querySelector('[data-composer-field]')!.getBoundingClientRect()
        const chip = document.querySelector('[aria-label^="Send to:"]')!.getBoundingClientRect()
        return { field: field.x, fieldTop: field.top, chip: chip.x, chipBottom: chip.bottom }
      })
      expect(at.chip).toBe(at.field)
      const chipToField = at.fieldTop - at.chipBottom
      expect(chipToField).toBeGreaterThan(0)
      expect(chipToField).toBeLessThanOrEqual(16)
    })
  }
})

// The topic chip (SPEC 12): on the destination chip's row, right of it, the same height; on a narrow page it shortens first.
test.describe('Home topic chip geometry', () => {
  for (const state of ['topic-main', 'topic-thread', 'topic-narrow'] as const) {
    test(`${state}: the topic chip sits right of the destination chip and inside the field's width`, async ({ page }) => {
      const id = `write/${state}`
      await openState(page, { component: 'Home', id, route: `Home/${id}`, group: '', groupId: '', state, frame: {} }, 'light')
      const at = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        const truncated = (selector: string) => {
          const label = document.querySelector(selector)!.querySelector(':scope > span:first-child > span:last-child')!
          return label.scrollWidth > label.clientWidth
        }
        const field = box('[data-composer-field]')
        const chip = box('[aria-label^="Send to:"]')
        const topic = box('[aria-label^="Topic:"]')
        return {
          field: { left: field.left, right: field.right },
          chip: { top: chip.top, height: chip.height, right: chip.right },
          topic: { top: topic.top, height: topic.height, left: topic.left, right: topic.right },
          chipTruncated: truncated('[aria-label^="Send to:"]'),
          topicTruncated: truncated('[aria-label^="Topic:"]'),
        }
      })
      expect(at.topic.top).toBe(at.chip.top)
      expect(at.topic.height).toBe(at.chip.height)
      expect(at.topic.left).toBeGreaterThan(at.chip.right)
      expect(at.topic.right).toBeLessThanOrEqual(at.field.right)
      expect(at.chipTruncated).toBe(false)
      expect(at.topicTruncated).toBe(state === 'topic-narrow')
    })
  }
})
