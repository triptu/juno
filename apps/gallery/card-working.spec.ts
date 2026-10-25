import { expect, type Page } from '@playwright/test'
import { test } from './support'

const log = (page: Page) => page.locator('[data-activation-log]')

/**
 * A card that took its click is working until the outcome arrives. Its buttons
 * stay in place and keep focus, read as disabled, and send nothing more from
 * the mouse or the keyboard: the agent takes a click only on an open card.
 */
test.describe('a working card', () => {
  test('disables its buttons after the click, without moving focus', async ({ page }) => {
    await page.goto('/#/RemoveCard?__state=remove/click-then-working')
    const card = page.locator('[data-chat-card="remove"]')
    const remove = card.getByRole('button', { name: 'Remove', exact: true })
    const keep = card.getByRole('button', { name: 'Keep', exact: true })
    await expect(remove).toBeEnabled()
    await remove.focus()
    await page.keyboard.press('Enter')
    await expect(log(page)).toHaveText('remove')
    await expect(card).toHaveAttribute('data-card-status', 'working')
    await expect(remove).toBeFocused()
    await expect(remove).toBeDisabled()
    await expect(keep).toBeDisabled()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Space')
    await keep.focus()
    await page.keyboard.press('Enter')
    await remove.dispatchEvent('click')
    await expect(log(page)).toHaveText('remove')
    // The checkbox is the card's own input, disabled by the card.
    await expect(card.getByRole('checkbox')).toBeDisabled()
  })

  test('disables both Dismiss buttons too', async ({ page }) => {
    await page.goto('/#/ResolveCard?__state=resolve/click-then-working')
    const card = page.locator('[data-chat-card="resolve"]')
    await card.getByRole('button', { name: 'Resolve', exact: true }).click()
    await expect(log(page)).toHaveText('resolve')
    const dismiss = card.getByRole('button', { name: 'Dismiss' })
    await expect(dismiss).toHaveCount(2)
    for (const button of await dismiss.all()) {
      await expect(button).toBeDisabled()
      await button.focus()
      await page.keyboard.press('Enter')
      await button.dispatchEvent('click')
    }
    await expect(log(page)).toHaveText('resolve')
  })
})
