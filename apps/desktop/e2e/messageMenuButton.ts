import type { Locator } from '@playwright/test'
import type { Juno } from './driver/juno'
import { expect, test } from './fixtures'

const boxOf = async (locator: Locator) => {
  const box = (await locator.boundingBox())!
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, width: box.width, height: box.height }
}

/** The same message menu reached from its hover button during the context-menu flow. */
export async function checkMessageMenuButton(juno: Juno, target: Locator, neighbour: Locator): Promise<void> {
  const menu = juno.messageMenu
  const button = target.locator('[data-message-more] button')
  await test.step('at rest no message shows it; under the pointer only the hovered one does, and nothing moves', async () => {
    await juno.win.mouse.move(5, 300)
    await expect(button).toBeHidden()
    const before = await boxOf(neighbour)
    await target.locator('[data-msg-text]').first().hover()
    await expect(button).toBeVisible()
    await expect(neighbour.locator('[data-message-more] button')).toBeHidden()
    expect(await boxOf(neighbour)).toEqual(before)
  })

  await test.step('the press opens the menu under the button, before the button comes up', async () => {
    const at = await boxOf(button)
    await juno.win.mouse.move(at.left + at.width / 2, at.top + at.height / 2)
    await juno.win.mouse.down()
    await expect(menu.root).toBeVisible()
    await juno.win.mouse.up()
    await expect(menu.root).toBeVisible()
    const box = await boxOf(menu.root)
    // Under the button, or above it near the window's bottom, never over it; lined up with its left edge (opening
    // right) or its right edge (opening left).
    if (Math.round(box.top) !== Math.round(at.bottom) + 1) expect(Math.round(box.bottom)).toBe(Math.round(at.top) - 1)
    expect(Math.min(Math.abs(box.left - at.left), Math.abs(box.right - at.right))).toBeLessThanOrEqual(1)
    await expect(target).toHaveAttribute('data-popover-active', '')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    // Held while the menu is open, wherever the pointer goes.
    await juno.win.mouse.move(5, 300)
    await expect(button).toBeVisible()
  })

  await test.step('a second press on the button closes the menu', async () => {
    const at = await boxOf(button)
    await juno.win.mouse.move(at.left + at.width / 2, at.top + at.height / 2)
    await juno.win.mouse.down()
    await juno.win.mouse.up()
    await expect(menu.root).toHaveCount(0)
    await expect(target).not.toHaveAttribute('data-popover-active')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  await test.step('Esc closes it too', async () => {
    await button.click()
    await expect(menu.root).toBeVisible()
    await juno.win.keyboard.press('Escape')
    await expect(menu.root).toHaveCount(0)
    await expect(target).not.toHaveAttribute('data-popover-active')
  })
}
